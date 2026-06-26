import asyncio
import hashlib
import io
import json
import logging
import os
import sys
import zipfile
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/azure-deploy", tags=["azure-deploy"])

_API_VER  = "2025-11-15-preview"
_FEATURES = "CodeAgents=V1Preview,HostedAgents=V1Preview"


def _endpoint() -> str:
    return (
        os.getenv("AZURE_AI_FOUNDRY_HOSTED_ENDPOINT")
        or os.getenv("FOUNDRY_PROJECT_ENDPOINT")
        or os.getenv("AZURE_AI_FOUNDRY_ENDPOINT")
        or ""
    ).rstrip("/")


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

def _sys(t: str) -> str: return _sse({"kind": "system",  "text": t})
def _out(t: str) -> str: return _sse({"kind": "output",  "text": t})
def _ok(t: str)  -> str: return _sse({"kind": "success", "text": t})
def _err(t: str) -> str: return _sse({"kind": "error",   "text": t})
def _done()      -> str: return "data: [DONE]\n\n"


# ── Pydantic models ───────────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    agent_name:       str
    code:             str               # the generated Python file from the editor
    system_prompt:    str = ""          # used only when code is empty
    model_deployment: str = "gpt-4.1-mini"
    cpu:              str = "1"
    memory:           str = "2Gi"
    runtime:          str = "python_3_13"

class InvokeRequest(BaseModel):
    agent_name: str
    input: str


# ── Azure auth ────────────────────────────────────────────────────────────────

async def _get_token() -> str:
    from azure.identity.aio import DefaultAzureCredential
    async with DefaultAzureCredential() as cred:
        tok = await cred.get_token("https://ai.azure.com/.default")
        return tok.token


# ── ZIP builder ───────────────────────────────────────────────────────────────

# Packages needed inside the container. Bundled mode downloads Linux wheels
# locally so Azure never needs to run pip during provisioning.
_WRAPPER_REQUIREMENTS = (
    "anthropic\n"
    "python-dotenv\n"
    "azure-ai-agentserver-responses==1.0.0b7\n"
)

# In-process cache keyed by requirements hash: avoids re-running pip on every deploy.
_PKG_CACHE: dict[str, dict[str, bytes]] = {}


async def _get_bundled_packages(requirements: str) -> dict[str, bytes]:
    """
    Download Python packages as manylinux2014_x86_64 wheels into a temp directory
    (even when running on Windows) and return a {rel_path: bytes} dict for inclusion
    in the ZIP under packages/.  Results are cached in memory after the first run.
    """
    import tempfile

    key = hashlib.sha256(requirements.encode()).hexdigest()[:16]
    if key in _PKG_CACHE:
        return _PKG_CACHE[key]

    pkgs = [p.strip() for p in requirements.splitlines() if p.strip()]

    with tempfile.TemporaryDirectory() as tmpdir:
        cmd = [
            sys.executable, "-m", "pip", "install",
            "--target",         tmpdir,
            "--platform",       "manylinux2014_x86_64",
            "--python-version", "3.13",
            "--implementation", "cp",
            "--only-binary",    ":all:",
            "--quiet",
            *pkgs,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"pip install failed:\n{stderr.decode()[:800]}")

        result: dict[str, bytes] = {}
        for dirpath, _, filenames in os.walk(tmpdir):
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                rel  = os.path.relpath(full, tmpdir).replace("\\", "/")
                with open(full, "rb") as fh:
                    result[rel] = fh.read()

    _PKG_CACHE[key] = result
    return result


# Azure Foundry Responses protocol — uses the official azure-ai-agentserver-responses SDK.
# The SDK handles the HTTP server, health/readiness probes, SSE streaming, and all
# Responses protocol event formatting. We only need to implement the handler.
_RESPONSES_SERVER = """

# ── Responses protocol server (azure-ai-agentserver-responses SDK) ────────────
import asyncio as _asyncio
from azure.ai.agentserver.responses import (
    CreateResponse as _CreateResponse,
    ResponseContext as _ResponseContext,
    ResponsesAgentServerHost as _Host,
    ResponsesServerOptions as _Opts,
    TextResponse as _TextResponse,
)

_app = _Host(options=_Opts(default_fetch_history_count=20))


@_app.response_handler
async def _handler(
    request: _CreateResponse,
    context: _ResponseContext,
    _cancel: _asyncio.Event,
):
    user_text = await context.get_input_text() or ""
    text = await _asyncio.get_running_loop().run_in_executor(
        None, lambda: run_agent(user_text)
    )
    return _TextResponse(context, request, text=text)


if __name__ == "__main__":
    _app.run()
"""


def _make_main_py(agent_code: str) -> str:
    """
    Embed the generated agent code into main.py and append the Responses server.
    Strips the generated __main__ block so the SDK server is the entry point.
    The packages/ sys.path injection MUST come before any agent imports.
    """
    lines = agent_code.splitlines()
    cut = next(
        (i for i, ln in enumerate(lines)
         if ln.strip().startswith("if __name__") and "__main__" in ln),
        len(lines),
    )
    agent_body = "\n".join(lines[:cut]).rstrip()

    # Prepend path setup so `import anthropic` (and other deps) resolves from packages/
    path_preamble = (
        "import sys as _sys, os as _os\n"
        "_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'packages'))\n\n"
    )
    return path_preamble + agent_body + _RESPONSES_SERVER


def _zip_info(name: str, is_exec: bool = False) -> zipfile.ZipInfo:
    """
    Create a ZipInfo with correct Unix permissions so extracted files are readable.
    Without explicit external_attr the default is 0 (mode 000) → Errno 5 / EACCES.
    """
    import stat as _stat
    info = zipfile.ZipInfo(filename=name)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3  # Unix
    mode = 0o755 if is_exec else 0o644
    # S_IFREG marks it as a regular file; without it some extractors treat it oddly
    info.external_attr = (_stat.S_IFREG | mode) << 16
    return info


def _build_zip(
    agent_code: str,
    packages: dict[str, bytes],
) -> tuple[bytes, str, list[str]]:
    """
    Build a bundled ZIP:
      main.py          — agent code + Invocations server (stdlib), mode 755
      requirements.txt — kept for reference, mode 644
      packages/<...>   — pre-built Linux wheels extracted by pip, mode 644
    """
    main_py = _make_main_py(agent_code)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(_zip_info("main.py", is_exec=True),          main_py)
        zf.writestr(_zip_info("requirements.txt"),                _WRAPPER_REQUIREMENTS)
        for rel_path, data in packages.items():
            zf.writestr(_zip_info(f"packages/{rel_path}"), data)

    data = buf.getvalue()

    with zipfile.ZipFile(io.BytesIO(data), "r") as verify:
        names = verify.namelist()

    if "main.py" not in names or "requirements.txt" not in names:
        raise RuntimeError(f"ZIP is missing core files (found: {names[:5]}…)")

    return data, hashlib.sha256(data).hexdigest(), names


# ── Deploy flow (SSE generator) ───────────────────────────────────────────────

async def _handle_deploy(req: DeployRequest) -> AsyncGenerator[str, None]:
    try:
        yield _sys(f"Deploying agent '{req.agent_name}' to Azure Foundry")

        endpoint = _endpoint()
        if not endpoint:
            yield _err("Azure endpoint not configured. Set AZURE_AI_FOUNDRY_ENDPOINT in .env")
            yield _done()
            return

        if not req.code.strip():
            yield _err("No code to deploy. Generate the agent code first, then click Deploy.")
            yield _done()
            return

        # 1. Download packages for bundled mode (cached after first run)
        yield _out("Downloading Linux-compatible packages (first run ~60s, then cached)…")
        try:
            packages = await _get_bundled_packages(_WRAPPER_REQUIREMENTS)
            yield _ok(f"Packages ready — {len(packages):,} files bundled")
        except Exception as exc:
            yield _err(f"Package download failed: {exc}")
            yield _done()
            return

        # 2. Build ZIP
        yield _out("Packaging generated code into ZIP…")
        try:
            zip_bytes, sha256, namelist = _build_zip(req.code, packages)
        except Exception as exc:
            yield _err(f"ZIP build failed: {exc}")
            yield _done()
            return

        yield _out(f"ZIP ready — {len(zip_bytes):,} bytes  (sha256: {sha256[:16]}…)")
        yield _out(f"ZIP root files: {[n for n in namelist if '/' not in n]}")

        # 3. Auth
        yield _out("Acquiring Azure credentials...")
        try:
            token = await _get_token()
        except Exception as exc:
            yield _err(f"Authentication failed: {exc}")
            yield _done()
            return

        # 4. Metadata — Invocations protocol, Anthropic key forwarded
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        metadata = {
            "description": f"Tavro-deployed agent: {req.agent_name}",
            "definition": {
                "kind": "hosted",
                "protocol_versions": [{"protocol": "responses", "version": "1.0.0"}],
                "cpu":    req.cpu,
                "memory": req.memory,
                "code_configuration": {
                    "runtime":               req.runtime,
                    "entry_point":           ["python", "main.py"],
                    "dependency_resolution": "bundled",
                },
                "environment_variables": {
                    "AZURE_AI_MODEL_DEPLOYMENT_NAME": req.model_deployment,
                    "ANTHROPIC_API_KEY":              anthropic_key,
                },
            },
        }

        common_headers = {
            "Authorization":    f"Bearer {token}",
            "Accept":           "application/json",
            "Foundry-Features": _FEATURES,
            "x-ms-code-zip-sha256": sha256,
        }

        # 5. Create or update
        yield _out(f"Uploading to {endpoint}...")

        async def _post(url: str, extra: dict) -> httpx.Response:
            async with httpx.AsyncClient(timeout=90) as c:
                return await c.post(
                    url,
                    headers={**common_headers, **extra},
                    files={
                        "metadata": ("metadata.json", json.dumps(metadata), "application/json"),
                        "code":     (f"{req.agent_name}.zip", zip_bytes, "application/zip"),
                    },
                )

        resp = await _post(
            f"{endpoint}/agents?api-version={_API_VER}",
            {"x-ms-agent-name": req.agent_name},
        )

        if resp.status_code == 409:
            yield _out("Agent already exists — pushing a new version...")
            resp = await _post(f"{endpoint}/agents/{req.agent_name}?api-version={_API_VER}", {})

        if resp.status_code not in (200, 201):
            yield _err(f"Upload failed ({resp.status_code}): {resp.text[:500]}")
            yield _done()
            return

        body = resp.json()
        version = (
            body.get("versions", {}).get("latest", {}).get("version")
            or body.get("version")
            or 1
        )
        yield _ok(f"Agent uploaded — version {version}")

        # 6. Poll until active (max 5 min / 60 attempts × 5 s)
        yield _out("Waiting for provisioning to complete…")
        poll_url = f"{endpoint}/agents/{req.agent_name}/versions/{version}?api-version={_API_VER}"
        poll_hdrs = {"Authorization": f"Bearer {token}", "Foundry-Features": _FEATURES}

        for attempt in range(60):
            await asyncio.sleep(5)
            try:
                async with httpx.AsyncClient(timeout=15) as c:
                    pr = await c.get(poll_url, headers=poll_hdrs)
            except httpx.RequestError:
                continue

            if pr.status_code != 200:
                continue

            status = pr.json().get("status", "")
            yield _out(f"[{attempt + 1}/60] {status}")

            if status == "active":
                invoke_url = (
                    f"{endpoint}/agents/{req.agent_name}"
                    "/endpoint/protocols/openai/responses?api-version=v1"
                )
                yield _ok("Agent is live!")
                yield _out(f"Invoke URL: {invoke_url}")
                yield _sse({
                    "kind":       "deploy_complete",
                    "agent_name": req.agent_name,
                    "version":    version,
                    "invoke_url": invoke_url,
                })
                yield _done()
                return

            if status == "failed":
                err = pr.json().get("error", {})
                yield _err(
                    f"Provisioning failed — {err.get('code', 'unknown')}: "
                    f"{err.get('message', 'No details available')}"
                )
                yield _done()
                return

        yield _err("Timed out after 5 minutes. Check Azure portal for provisioning logs.")
        yield _done()

    except Exception as exc:
        # Last-resort catch so exceptions never silently close the SSE stream
        yield _err(f"Unexpected error: {exc}")
        yield _done()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/stream")
async def deploy_stream(body: DeployRequest):
    """Deploy an agent to Azure Foundry and stream SSE progress events."""
    return StreamingResponse(
        _handle_deploy(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/status")
async def get_status(
    agent_name: str = Query(...),
    version:    int = Query(1),
):
    ep = _endpoint()
    if not ep:
        raise HTTPException(status_code=500, detail="AZURE_AI_FOUNDRY_HOSTED_ENDPOINT not configured")
    try:
        token = await _get_token()
    except Exception as exc:
        logger.error("Azure auth token acquisition failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Azure authentication failed. Please check your Azure credentials and try again.")

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{ep}/agents/{agent_name}/versions/{version}?api-version={_API_VER}",
            headers={"Authorization": f"Bearer {token}", "Foundry-Features": _FEATURES},
        )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Agent version not found")
    r.raise_for_status()
    return r.json()


@router.post("/invoke")
async def invoke_agent(body: InvokeRequest):
    """Invoke a deployed Azure Foundry agent via the Invocations protocol."""
    ep = _endpoint()
    if not ep:
        raise HTTPException(status_code=500, detail="AZURE_AI_FOUNDRY_HOSTED_ENDPOINT not configured")
    try:
        token = await _get_token()
    except Exception as exc:
        logger.error("Azure auth token acquisition failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Azure authentication failed. Please check your Azure credentials and try again.")

    url = f"{ep}/agents/{body.agent_name}/endpoint/protocols/invocations?api-version=v1"
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            url,
            headers={
                "Authorization":    f"Bearer {token}",
                "Content-Type":     "application/json",
                "Foundry-Features": _FEATURES,
            },
            json={"input": body.input},
        )
    if not r.is_success:
        logger.error("Azure deploy endpoint returned %s: %s", r.status_code, r.text[:500])
        raise HTTPException(status_code=r.status_code, detail="The Azure deployment request failed. Please verify your configuration and try again.")
    return r.json()


@router.delete("/agent")
async def delete_agent(
    agent_name: str  = Query(...),
    force:      bool = Query(False),
):
    ep = _endpoint()
    if not ep:
        raise HTTPException(status_code=500, detail="AZURE_AI_FOUNDRY_HOSTED_ENDPOINT not configured")
    try:
        token = await _get_token()
    except Exception as exc:
        logger.error("Azure auth token acquisition failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Azure authentication failed. Please check your Azure credentials and try again.")

    qs = f"?api-version={_API_VER}" + ("&force=true" if force else "")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(
            f"{ep}/agents/{agent_name}{qs}",
            headers={"Authorization": f"Bearer {token}", "Foundry-Features": _FEATURES},
        )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Agent not found")
    r.raise_for_status()
    return {"status": "deleted", "agent_name": agent_name}