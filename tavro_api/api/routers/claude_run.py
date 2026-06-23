import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter(prefix="/api/v1/claude-run", tags=["claude-run"])

GENERATED_AGENTS_ROOT = Path(
    os.getenv("GENERATED_AGENTS_ROOT", "generated_agents")
).resolve()

AGENT_CARDS_DIR = Path(
    os.getenv("AGENT_CARDS_DIR", "agent_cards")
).resolve()

def _safe_generated_path(path: str) -> Path:
    clean = path.replace("generated_agents/", "").lstrip("/")
    requested = (GENERATED_AGENTS_ROOT / clean).resolve()

    if not str(requested).startswith(str(GENERATED_AGENTS_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    return requested

class RunRequest(BaseModel):
    command: str
    current_code: str = ""

    agent_id: str | None = None
    agent_name: str | None = None
    agent_description: str | None = None
    agent_instruction: str | None = None

class SaveFileRequest(BaseModel):
    path: str
    content: str

class SaveToDbRequest(BaseModel):
    agent_id: str
    filename: str
    code: str
    tenant_id: str | None = None
    agent_internal_id: str | None = None

class PublishToGitRequest(BaseModel):
    agent_id: str
    filename: str
    code: str
    commit_message: str | None = None


# ── SSE helpers ──────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

def _extract_code(raw: str) -> str:
    """Extract pure Python from a response that may contain explanation text and/or markdown fences."""
    raw = raw.strip()
    # If there's a fenced code block anywhere, extract what's inside the first one
    m = re.search(r'```(?:python)?\n?(.*?)```', raw, re.DOTALL)
    if m:
        return m.group(1).strip()
    # No fences — drop any leading prose lines before the first Python-looking line
    lines = raw.splitlines()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(('import ', 'from ', '"""', "'''", '#', 'def ', 'class ', 'async ')):
            return '\n'.join(lines[i:])
    return raw

def _sys(text: str)     -> str: return _sse({"kind": "system",  "text": text})
def _out(text: str)     -> str: return _sse({"kind": "output",  "text": text})
def _ok(text: str)      -> str: return _sse({"kind": "success", "text": text})
def _err(text: str)     -> str: return _sse({"kind": "error",   "text": text})
def _done()             -> str: return "data: [DONE]\n\n"


# ── Agent card loader ────────────────────────────────────────────────────────

def _load_agent_card(agent_id: str) -> dict | None:
    """Load agent card JSON by agent_id. Returns None if not found."""
    path = AGENT_CARDS_DIR / f"{agent_id}_agent_card.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    # Fallback: scan all cards for matching id
    for f in AGENT_CARDS_DIR.glob("*_agent_card.json"):
        try:
            card = json.loads(f.read_text(encoding="utf-8"))
            ident = card.get("identification", {})
            if ident.get("agent_id") == agent_id or card.get("name") == agent_id:
                return card
        except Exception:
            continue
    return None


# ── Prompt builder ───────────────────────────────────────────────────────────

def _build_generation_prompt(card: dict, agent_id: str) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for code generation."""
    ident     = card.get("identification", {})
    tools     = card.get("tool", []) or []
    sources   = card.get("data_source", []) or []
    ks        = card.get("knowledge_source") or {}
    risk      = card.get("risk_assessment", {}) or {}
    use_cases = card.get("ai_use_case", []) or []
    uc        = (use_cases[0] if isinstance(use_cases, list) and use_cases else use_cases) or {}

    name        = card.get("name", agent_id)
    description = card.get("description", "")
    instruction = ident.get("instruction", "")
    role        = ident.get("role", "")
    gov_status  = ident.get("governance_status", "")

    source_names = list({s.get("source_object_name", "") for s in sources if isinstance(s, dict) and s.get("source_object_name")})
    uses_pii     = any(str(s.get("uses_pii", "")).lower() == "yes" for s in sources if isinstance(s, dict))
    uses_phi     = any(str(s.get("uses_phi", "")).lower() == "yes" for s in sources if isinstance(s, dict))
    uses_pci     = any(str(s.get("uses_pci", "")).lower() == "yes" for s in sources if isinstance(s, dict))

    risk_class = risk.get("blended_risk_classification") or "Unknown"
    risk_score = risk.get("blended_risk_score") or "N/A"
    aivss      = risk.get("aivss_score") or "N/A"
    eu_act     = risk.get("regulatory_risk_classification") or "N/A"

    ks_name  = ks.get("name", "") if isinstance(ks, dict) else ""
    ks_desc  = ks.get("description", "") if isinstance(ks, dict) else ""
    uc_name  = uc.get("name", "") if isinstance(uc, dict) else ""
    uc_prob  = uc.get("problem_statement", "") if isinstance(uc, dict) else ""
    uc_ben   = uc.get("expected_benefits", "") if isinstance(uc, dict) else ""
    uc_id    = uc.get("identifier", "") if isinstance(uc, dict) else ""

    slugify  = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_') or 'agent'
    filename = f"{slugify(agent_id)}_{slugify(name)}.py"

    system = (
        "You are a senior Python engineer generating production-ready Anthropic agent code "
        "for the Tavro AI governance platform. Write clean, well-structured Python. "
        "Return ONLY the complete Python source file — no markdown, no explanation, no fences."
    )

    user = f"""Generate a complete Python agent implementation file for:

Agent: {name}
Tavro ID: {agent_id}
File: {filename}

## Context
Role: {role}
Description: {description}
Governance status: {gov_status or "Not set"}

## AI Use Case
ID: {uc_id}
Name: {uc_name}
Problem: {uc_prob}
Expected benefits: {uc_ben}

## Tools ({len(tools)} total)
{json.dumps([{"name": t.get("name"), "description": t.get("description")} for t in tools if isinstance(t, dict)], indent=2)}

## Data Sources
{json.dumps(source_names, indent=2)}
PII: {"Yes" if uses_pii else "No"} | PHI: {"Yes" if uses_phi else "No"} | PCI: {"Yes" if uses_pci else "No"}

## Knowledge Source
Name: {ks_name}
Description: {ks_desc}

## Risk
Classification: {risk_class} | Score: {risk_score}
EU AI Act: {eu_act} | AIVSS: {aivss}

## Instruction
{instruction}

## Requirements

### Module docstring
Include all metadata: Agent, Tavro ID, Risk, Tools, Data Sources.

### Imports
```python
import os, json
from dataclasses import dataclass, field
from typing import Optional, List, Any
import anthropic
from dotenv import load_dotenv
load_dotenv()
```

### Data models
For each data source name define a @dataclass with realistic fields.
Mark PII/PHI/PCI fields with inline comments.

### Tool stubs
For each tool define a typed Python function with a docstring.
Body: `# TODO: Replace with real integration`

### TOOLS list
Claude tool definitions list (name, description, input_schema).

### Tool dispatcher
```python
def handle_tool_call(name: str, inputs: dict) -> Any: ...
```

### SYSTEM_PROMPT
Build a rich system prompt including:
- Governance warning if status is not "Approved"
- Role and identity
- Business context from use case
- Operational instructions (verbatim from instruction field)
- Data sensitivity guardrails (PII/PHI/PCI)
- Risk-aware guardrails based on risk classification

### Agentic loop
```python
def run_agent(user_message: str) -> str:
    # Uses claude-sonnet-4-6, max_tokens=4096
    # Standard tool-use loop: tool_use → handle_tool_call → continue
```

### main()
A realistic invocation derived from the problem statement. Not a generic placeholder.

### Approval workflow
After main(), include:
```python
def approval_workflow(): ...
def publish_to_azure(): ...
def fix_issues(): ...
```

### Entry point
```python
if __name__ == "__main__":
    main()
    approval_workflow()
```

Write the complete file now. Return ONLY the Python source — no markdown blocks."""

    return system, user


# ── Anthropic API streaming (used for code generation / updates) ─────────────

async def _stream_anthropic(system: str, user: str) -> AsyncGenerator[str, None]:
    """Stream text directly from the Anthropic API — no CLI, no file system ops."""
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    client = anthropic.AsyncAnthropic(api_key=api_key)
    async with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        extra_headers={"anthropic-beta": "output-128k-2025-02-19"},
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def _stream_anthropic_with_heartbeat(
    system: str, user: str, sse_queue: "asyncio.Queue[str | None]"
) -> None:
    """Run _stream_anthropic and push chunks onto sse_queue; push None when done."""
    try:
        async for chunk in _stream_anthropic(system, user):
            await sse_queue.put(chunk)
    except Exception as exc:
        await sse_queue.put(exc)  # type: ignore[arg-type]
    finally:
        await sse_queue.put(None)


# ── Claude Code CLI streaming (used for open-ended claude "<prompt>" commands) ─

async def _run_claude_cli(prompt: str) -> AsyncGenerator[str, None]:
    """Run `claude --print '<prompt>'` and yield output chunks."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    env = {**os.environ, "ANTHROPIC_API_KEY": api_key}
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        async for raw in proc.stdout:
            yield raw.decode("utf-8", errors="replace")
        await proc.wait()
        if proc.returncode not in (0, None):
            raise RuntimeError(f"claude exited with code {proc.returncode}")
    except FileNotFoundError:
        raise RuntimeError("claude CLI not found — install with: npm i -g @anthropic-ai/claude-code")


# ── Command handlers ─────────────────────────────────────────────────────────

async def _handle_update(filename: str, instruction: str, current_code: str) -> AsyncGenerator[str, None]:
    """Apply a natural-language instruction to the code currently open in the editor."""
    yield _sys(f"Updating: {filename}")

    if not current_code.strip():
        yield _err("No code in editor. Generate or load a file first.")
        yield _done()
        return

    yield _out(f"Applying instruction: {instruction}")

    system = (
        "You are a senior Python engineer. Apply the requested change precisely and return "
        "ONLY the complete modified Python source file — no markdown, no explanation, no fences."
    )
    user = (
        f"Instruction: {instruction}\n\nCurrent code:\n{current_code}\n\n"
        "Return only the complete modified Python source file."
    )

    try:
        queue: asyncio.Queue = asyncio.Queue()
        task = asyncio.create_task(_stream_anthropic_with_heartbeat(system, user, queue))
        code_lines: list[str] = []
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            code_lines.append(item)
        await task

        code = _extract_code("".join(code_lines))
        line_count = code.count('\n') + 1
        yield _ok(f"✓ Updated: {filename} ({line_count} lines)")
        yield _sse({"kind": "file_content", "path": filename, "content": code})
    except Exception as exc:
        yield _err(f"Update failed: {exc}")

    yield _done()


async def _handle_generate(agent_id: str) -> AsyncGenerator[str, None]:
    yield _sys(f"Generating code for agent: {agent_id}")

    card = _load_agent_card(agent_id)
    if not card:
        yield _err(f"Agent card not found for '{agent_id}'. Make sure the agent exists in Tavro.")
        yield _done()
        return

    name = card.get("name", agent_id)
    yield _out(f"Agent: {name}")
    yield _out("Loaded agent card.")
    yield _out("Building generation prompt...")
    system, user = _build_generation_prompt(card, agent_id)

    slugify  = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_') or 'agent'
    filename = f"{slugify(agent_id)}_{slugify(name)}.py"

    try:
        queue: asyncio.Queue = asyncio.Queue()
        task = asyncio.create_task(_stream_anthropic_with_heartbeat(system, user, queue))
        code_lines: list[str] = []
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            code_lines.append(item)
        await task

        code = _extract_code("".join(code_lines))
        line_count = code.count('\n') + 1

        yield _ok(f"✓ Generated: {filename} ({line_count} lines)")
        yield _sse({
            "kind": "file_content",
            "path": filename,
            "content": code,
        })
        yield _out("")
        yield _out("Code is open in the editor above. Click Save to persist it.")

    except Exception as exc:
        yield _err(f"Generation failed: {exc}")

    yield _done()

async def _handle_python_run(filepath: str) -> AsyncGenerator[str, None]:
    try:
        requested = _safe_generated_path(filepath)
    except HTTPException:
        yield _err("Access denied")
        yield _done()
        return

    yield _sys(f"Running: python {requested.name}")

    if not requested.exists():
        yield _err("File not found. Generate or save the file first.")
        yield _done()
        return

    try:
        proc = await asyncio.create_subprocess_exec(
            "python",
            str(requested),
            cwd=str(GENERATED_AGENTS_ROOT.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if line:
                yield _out(line)

        await proc.wait()

        if proc.returncode == 0:
            yield _ok("✓ Exited with code 0")
        else:
            yield _err(f"✗ Exited with code {proc.returncode}")

    except FileNotFoundError:
        yield _err("python not found in PATH")
    except Exception as exc:
        yield _err(f"Error: {exc}")

    yield _done()

async def _handle_generic(command: str) -> AsyncGenerator[str, None]:
    yield _sys(f"Running: {command}")
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if line:
                yield _out(line)
        await proc.wait()
        if proc.returncode == 0:
            yield _ok(f"✓ Exited with code 0")
        else:
            yield _err(f"✗ Exited with code {proc.returncode}")
    except Exception as exc:
        yield _err(f"Error: {exc}")
    yield _done()


async def _handle_claude_prompt(
    prompt: str,
    agent_id: str | None,
    agent_name: str | None,
    agent_description: str | None,
    agent_instruction: str | None,
    current_code: str,
) -> AsyncGenerator[str, None]:

    yield _sys("Asking Claude...")

    full_prompt = f"""
Agent ID: {agent_id}

Agent Name:
{agent_name}

Description:
{agent_description}

Instructions:
{agent_instruction}

Current Code:
{current_code[:20000]}

User Question:
{prompt}
"""

    try:
        response_parts = []

        async for chunk in _run_claude_cli(full_prompt):
            response_parts.append(chunk)

        response = "".join(response_parts)

        yield _out(response)
        yield _ok("✓ Claude response complete")

    except Exception as exc:
        yield _err(f"Claude error: {exc}")

    yield _done()
    
async def _handle_deploy_to_azure(agent_id: str, current_code: str = "") -> AsyncGenerator[str, None]:
    """Load an agent card and deploy the generated code to Azure Foundry."""
    from api.routers.azure_deploy import DeployRequest, _handle_deploy

    card = _load_agent_card(agent_id)
    if not card:
        yield _err(f"Agent card not found for '{agent_id}'.")
        yield _done()
        return

    name  = card.get("name", agent_id)
    ident = card.get("identification", {})
    role  = ident.get("role", "")
    instr = ident.get("instruction", "")

    # Azure agent names: alphanumeric + hyphens, max 63 chars
    slug = re.sub(r'[^a-z0-9-]+', '-', agent_id.lower()).strip('-')[:63]

    async for chunk in _handle_deploy(DeployRequest(
        agent_name    = slug,
        code          = current_code,
        system_prompt = f"You are {name}. {role}\n\n{instr}".strip(),
    )):
        yield chunk


async def _dispatch(body: RunRequest) -> AsyncGenerator[str, None]:
    """Route a command string to the appropriate handler."""
    cmd = body.command.strip()

    # /generate-agent-code <agent_id>
    m = re.match(r'^/generate-agent-code\s+(\S+)', cmd, re.IGNORECASE)
    if m:
        async for chunk in _handle_generate(m.group(1)):
            yield chunk
        return

    # /deploy-to-azure <agent_id>
    m = re.match(r'^/deploy-to-azure\s+(\S+)', cmd, re.IGNORECASE)
    if m:
        async for chunk in _handle_deploy_to_azure(m.group(1), body.current_code):
            yield chunk
        return

    # update <filepath>: <instruction>
    m = re.match(r'^update\s+(\S+):\s*(.+)', cmd, re.IGNORECASE)
    if m:
        async for chunk in _handle_update(m.group(1), m.group(2).strip(), body.current_code):
            yield chunk
        return

    # python <file>
    m = re.match(r'^python\s+(\S+)', cmd)
    if m:
        async for chunk in _handle_python_run(m.group(1)):
            yield chunk
        return

    # bare `claude` with no prompt — show usage
    if cmd.lower() == 'claude':
        yield _err('Usage: claude "<prompt>"  or  claude <prompt without quotes>')
        yield _out('Example: claude give me the system prompt of this agent')
        yield _done()
        return

    # claude "<prompt>" or claude <prompt> — send to Anthropic with agent context
    m = re.match(r'^claude\s+"(.+)"$', cmd, re.DOTALL)
    if not m:
        m = re.match(r"^claude\s+'(.+)'$", cmd, re.DOTALL)
    if not m:
        m = re.match(r'^claude\s+(.+)', cmd, re.DOTALL)
    if m:
        async for chunk in _handle_claude_prompt(
            m.group(1).strip(),
            agent_id=body.agent_id,
            agent_name=body.agent_name,
            agent_description=body.agent_description,
            agent_instruction=body.agent_instruction,
            current_code=body.current_code,
        ):
            yield chunk
        return

    # Fallback: generic shell command
    async for chunk in _handle_generic(cmd):
        yield chunk


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/stream")
async def stream_command(body: RunRequest):
    """Execute a command and stream output as SSE."""
    return StreamingResponse(
        _dispatch(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/file")
async def read_file(path: str = Query(...)):
    requested = _safe_generated_path(path)

    if not requested.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not requested.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    return {
        "path": str(requested.relative_to(GENERATED_AGENTS_ROOT)),
        "content": requested.read_text(encoding="utf-8"),
    }

@router.post("/file")
async def save_file(body: SaveFileRequest):
    requested = _safe_generated_path(body.path)

    requested.parent.mkdir(parents=True, exist_ok=True)
    requested.write_text(body.content, encoding="utf-8")

    return {
        "status": "saved",
        "path": str(requested.relative_to(GENERATED_AGENTS_ROOT)),
    }

@router.get("/files")
async def list_files():
    """List all files in the generated_agents directory."""
    if not GENERATED_AGENTS_ROOT.exists():
        return {"files": []}
    files = [
        str(f.relative_to(GENERATED_AGENTS_ROOT))
        for f in GENERATED_AGENTS_ROOT.rglob("*")
        if f.is_file()
    ]
    return {"files": sorted(files)}


@router.post("/save-to-db")
async def save_to_db(body: SaveToDbRequest, db: AsyncSession = Depends(get_db)):
    """Upsert generated agent code into the database."""
    await db.execute(
        text("""
            INSERT INTO core.agent_generated_code (agent_internal_id, tenant_id, agent_id, filename, code, updated_at)
            VALUES (:agent_internal_id, :tenant_id, :agent_id, :filename, :code, now())
            ON CONFLICT (agent_id, filename)
            DO UPDATE SET
                code = EXCLUDED.code,
                agent_internal_id = EXCLUDED.agent_internal_id,
                tenant_id = EXCLUDED.tenant_id,
                updated_at = now()
        """),
        {
            "agent_internal_id": body.agent_internal_id,
            "tenant_id": body.tenant_id,
            "agent_id": body.agent_id,
            "filename": body.filename,
            "code": body.code,
        },
    )
    await db.commit()
    return {"status": "saved", "agent_id": body.agent_id, "filename": body.filename}


@router.get("/load-from-db")
async def load_from_db(
    agent_id: str = Query(...),
    filename: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Load previously saved generated agent code from the database."""
    try:
        result = await db.execute(
            text("""
                SELECT code, tenant_id, agent_internal_id, updated_at
                FROM core.agent_generated_code
                WHERE agent_id = :agent_id AND filename = :filename
            """),
            {"agent_id": agent_id, "filename": filename},
        )
        row = result.fetchone()
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")

    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    return {
        "agent_id": agent_id,
        "filename": filename,
        "code": row[0],
        "tenant_id": row[1],
        "tavro_internal_id": row[2],
        "updated_at": str(row[3]),
    }


def _read_env_var(key: str, default: str = "") -> str:
    """Read a variable from the process env first, then fall back to the .env file."""
    val = os.getenv(key, "").strip()
    if val:
        return val
    env_file = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
    if not env_file.exists():
        return default
    import re as _re
    for line in env_file.read_text(encoding="utf-8").splitlines():
        m = _re.match(rf'^{_re.escape(key)}\s*=\s*(.*)', line.strip())
        if m:
            v = m.group(1)
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            return v.strip()
    return default


@router.post("/publish-to-git")
async def publish_to_git(body: PublishToGitRequest):
    """Push an agent source file to the configured git repository via GitHub API."""
    import logging
    log = logging.getLogger("publish_to_git")

    env_file_path = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
    log.info(f"[publish-to-git] ENV_FILE_PATH resolved to: {env_file_path} (exists={env_file_path.exists()})")

    repo_url = _read_env_var("GIT_PUBLISH_REPO_URL")
    token    = _read_env_var("GIT_PUBLISH_TOKEN")
    branch   = _read_env_var("GIT_PUBLISH_BRANCH", "main") or "main"

    log.info(f"[publish-to-git] repo_url={repo_url!r}  branch={branch!r}  token_set={bool(token)}")

    if not repo_url:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Git repository not configured — GIT_PUBLISH_REPO_URL is empty. "
                f".env file path: {env_file_path} (exists={env_file_path.exists()})"
            ),
        )
    if not token:
        raise HTTPException(
            status_code=503,
            detail=f"Git token not configured — GIT_PUBLISH_TOKEN is empty. repo_url={repo_url!r}",
        )

    # Parse https://github.com/owner/repo  or  owner/repo
    cleaned = repo_url.rstrip("/")
    if "github.com/" in cleaned:
        cleaned = cleaned.split("github.com/", 1)[1]
    cleaned = cleaned.removesuffix(".git")
    parts = [p for p in cleaned.split("/") if p]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail=f"Cannot parse GitHub owner/repo from: {repo_url!r}")
    owner, repo = parts[0], parts[1]
    log.info(f"[publish-to-git] Parsed → owner={owner!r}  repo={repo!r}")

    file_path_in_repo = f"agents/{body.agent_id}/{body.filename}"
    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path_in_repo}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    encoded = base64.b64encode(body.code.encode()).decode()
    commit_msg = body.commit_message or f"chore: publish agent {body.agent_id} ({body.filename})"

    async with httpx.AsyncClient(timeout=20) as client:
        # Check if file already exists to get its SHA (required for update)
        existing_sha: str | None = None
        log.info(f"[publish-to-git] GET {api_url}  branch={branch!r}")
        get_resp = await client.get(api_url, headers=headers, params={"ref": branch})
        log.info(f"[publish-to-git] GET status={get_resp.status_code}")
        if get_resp.status_code == 200:
            existing_sha = get_resp.json().get("sha")
            log.info(f"[publish-to-git] File exists, sha={existing_sha!r}")
        elif get_resp.status_code not in (404,):
            log.warning(f"[publish-to-git] Unexpected GET status {get_resp.status_code}: {get_resp.text[:300]}")

        payload: dict = {
            "message": commit_msg,
            "content": encoded,
            "branch":  branch,
        }
        if existing_sha:
            payload["sha"] = existing_sha

        log.info(f"[publish-to-git] PUT {api_url}  sha_present={bool(existing_sha)}")
        put_resp = await client.put(api_url, headers=headers, json=payload)
        log.info(f"[publish-to-git] PUT status={put_resp.status_code}  body={put_resp.text[:300]}")

    if put_resp.status_code not in (200, 201):
        try:
            gh_msg = put_resp.json().get("message", put_resp.text)
        except Exception:
            gh_msg = put_resp.text
        log.error(f"[publish-to-git] GitHub rejected PUT: status={put_resp.status_code}  message={gh_msg!r}")
        raise HTTPException(
            status_code=502,
            detail=f"GitHub API error ({put_resp.status_code}): {gh_msg}",
        )

    result = put_resp.json()
    html_url = result.get("content", {}).get("html_url", "")
    log.info(f"[publish-to-git] ✓ Published → {html_url}")
    return {
        "status": "published",
        "url": html_url,
        "repo": f"{owner}/{repo}",
        "branch": branch,
        "path": file_path_in_repo,
    }