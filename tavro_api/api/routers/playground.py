# =============================================================
# api/routers/playground.py
# Stateful agent playground sessions — Claude managed execution.
# Sessions are held in-memory (suitable for POC / single-instance).
# For multi-instance deployments, replace session_store with Redis.
# =============================================================

import base64
import asyncio
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

import boto3
from botocore.exceptions import ClientError
import httpx
from azure.identity import DefaultAzureCredential
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.error_handler import raise_server_error

router = APIRouter()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-6"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL_DEFAULT = "gpt-4o"

AZURE_OPENAI_API_VERSION_DEFAULT = "2024-02-15-preview"
AZURE_FOUNDRY_AGENT_API_VERSION_DEFAULT = "v1"
AZURE_FOUNDRY_USE_AGENT_RUNS_DEFAULT = "false"
AZURE_FOUNDRY_USE_CHAT_COMPLETIONS_DEFAULT = "false"

AWS_BEDROCK_REGION_DEFAULT = "us-east-2"
AWS_BEDROCK_MODEL_DEFAULT = "claude-3-5-sonnet"

# Cross-region inference profile IDs (work across us-east-1/2 and us-west-2)
BEDROCK_MODEL_MAP = {
    "claude-3-5-sonnet": "anthropic.claude-3-5-sonnet-20241022-v1:0",
    "claude-3-sonnet":   "anthropic.claude-3-sonnet-20240229-v1:0",
    "claude-3-haiku":    "anthropic.claude-3-haiku-20240307-v1:0",
    "claude-3-opus":     "anthropic.claude-3-opus-20240229-v1:0",
    "gpt-oss-120b": "openai.gpt-oss-120b-1:0",
    "gpt-oss-20b":  "openai.gpt-oss-20b-1:0",
    "gpt-oss-safeguard-120b": "openai.gpt-oss-safeguard-120b-v1:0",
    "llama-3-1-70b":     "meta.llama3-1-70b-instruct-v1:0",
    "llama-3-8b":        "meta.llama3-8b-instruct-v1:0",
    "mistral-large":     "mistral.mistral-large-2402-v1:0",
    "mistral-7b":        "mistral.mistral-7b-instruct-v0:0",
}

# Bedrock Agent foundationModel IDs — only Claude models are supported for agent runtime
BEDROCK_AGENT_SUPPORTED_MODELS = {
    "claude-3-5-sonnet": "anthropic.claude-3-5-sonnet-20241022-v1:0",
    "claude-3-sonnet":   "anthropic.claude-3-sonnet-20240229-v1:0",
    "claude-3-haiku":    "anthropic.claude-3-haiku-20240307-v1:0",
    "claude-3-opus":     "anthropic.claude-3-opus-20240229-v1:0",

    "gpt-oss-120b": "openai.gpt-oss-120b-1:0",
    "gpt-oss-20b":  "openai.gpt-oss-20b-1:0",
}

def _resolve_bedrock_model(model_id: str) -> str:
    """Resolve model ID for bedrock-runtime (converse API)."""
    if model_id in BEDROCK_MODEL_MAP:
        return BEDROCK_MODEL_MAP[model_id]
    # Already a fully-qualified Bedrock ID (contains dots or cross-region prefix)
    if "." in model_id:
        return model_id
    # Try OpenAI-style Bedrock model names if a plain key is passed.
    if model_id.startswith("gpt-oss"):
        return f"openai.{model_id}-v1:0"
    return BEDROCK_MODEL_MAP["claude-3-5-sonnet"]

def _resolve_bedrock_agent_model(model_id: str) -> str:
    """Resolve model ID for bedrock-agents (agent creation) - NO 'us.' prefix"""
    # Get the runtime model ID first
    runtime_model = _resolve_bedrock_model(model_id or AWS_BEDROCK_MODEL_DEFAULT)
    # Strip the 'us.' prefix if present (it's only for runtime cross-region inference)
    if runtime_model.startswith("us."):
        return runtime_model[3:]  # Remove 'us.' prefix
    return runtime_model

# ── In-memory session store ───────────────────────────────────────────────────
# { session_id: { config, messages, created_at, updated_at } }
session_store: dict[str, dict] = {}


# =============================================================
# Schemas
# =============================================================

class ToolConfig(BaseModel):
    id:      str
    name:    str
    enabled: bool
    source:  str

class SessionConfig(BaseModel):
    agent_name:    str
    system_prompt: str
    provider:      str = "claude"
    model:         str = ANTHROPIC_MODEL_DEFAULT
    temperature:   float = 0.7
    max_tokens:    int = 2048
    tools:         list[ToolConfig] = []
    company_id:    str | None = None
    company_name:  str | None = None
    use_case_id:   str | None = None
    use_case_title: str | None = None

class Attachment(BaseModel):
    name:      str          # original filename
    mime_type: str          # e.g. application/pdf, image/png, text/csv
    data:      str          # base64-encoded file content

class MessageRequest(BaseModel):
    content:     str
    attachments: list[Attachment] = []

class SessionMessage(BaseModel):
    id:              str
    role:            str
    content:         str
    timestamp:       str
    tokens:          int | None = None
    attachment_names: list[str] = []

class SessionResponse(BaseModel):
    session_id:  str
    config:      SessionConfig
    messages:    list[SessionMessage]
    created_at:  str
    updated_at:  str
    token_total: int

class AzureFoundryAgentProvisioning(BaseModel):
    enabled: bool = False
    agent_name: str | None = None
    agent: dict[str, Any] | None = None

class BedrockAgentProvisioning(BaseModel):
    enabled: bool = False
    agent_id: str | None = None
    agent_name: str | None = None
    agent_arn: str | None = None
    agent_session_id: str | None = None  # Session ID for agent invocations
    agent_alias_id: str | None = None
    agent_alias_name: str | None = None
    agent: dict[str, Any] | None = None

# =============================================================
# PDF-export helpers
# =============================================================

# Injected at the END of the system prompt whenever the user's message
# requests a PDF.  Uses strong imperative language so it overrides any
# conflicting agent-persona instruction ("I'm a weather agent and can't
# make PDFs", etc.).
_PDF_SYSTEM_INJECT = """

---
[PLATFORM OVERRIDE - PDF EXPORT MODE]
The user has requested a PDF. The following rules OVERRIDE all other instructions:
1. Respond with ONLY the report content in clean markdown — no preamble, no closing remarks.
2. Start IMMEDIATELY with a # Report Title heading that names the report topic.
   - Do NOT start with "Here is...", "Sure,...", "I appreciate...", "I'm unable...", or any sentence before the heading.
3. Do NOT say you cannot create, generate, or export PDF files. The platform generates the PDF automatically from your text response.
4. Do NOT add any closing sentence ("Your PDF...", "I hope...", "Let me know...", "Would you like...").
5. Use ## for sections, **bold** for key terms, - for bullets, | tables | for tabular data.
6. ASCII only — no emojis, no Unicode symbols.
This instruction takes precedence over your agent persona and any other system instructions.
"""


def _is_pdf_request(text: str) -> bool:
    """Return True when the user's message is asking for a PDF."""
    msg = text.lower()
    if "pdf" not in msg:
        return False
    phrases  = ["in pdf", "as pdf", "as a pdf", "to pdf", "into pdf"]
    actions  = ["generate", "create", "download", "export", "give", "provide",
                "get", "make", "produce", "output", "save", "report"]
    return any(p in msg for p in phrases) or any(a in msg for a in actions)


# =============================================================
# Helpers
# =============================================================

def _build_tools(config: SessionConfig, company_dims: list[dict]) -> list[dict]:
    """Build the Anthropic tools list from the session config."""
    tools = []
    enabled = {t.id for t in config.tools if t.enabled}

    if 'web_search' in enabled:
        tools.append({
            "type": "web_search_20250305",
            "name": "web_search",
        })

    if 'blueprint_context' in enabled and company_dims:
        tools.append({
            "name":        "get_blueprint_context",
            "description": (
                f"Retrieve company blueprint dimensions for {config.company_name or 'the company'}. "
                "Use this to ground your responses in the company's actual business context."
            ),
            "input_schema": {
                "type":       "object",
                "properties": {
                    "category": {
                        "type":        "string",
                        "description": "Filter by dimension category (optional): profile, strategy, process, application, organisation, technology, risk, custom",
                    }
                },
                "required": [],
            },
        })

    return tools


def _handle_tool_call(
    tool_name: str,
    tool_input: dict,
    company_dims: list[dict],
) -> str:
    """Execute a tool call and return the result as a string."""
    if tool_name == "get_blueprint_context":
        category = tool_input.get("category")
        dims = company_dims
        if category:
            dims = [d for d in dims if d.get("category") == category]
        if not dims:
            return f"No blueprint dimensions found{' for category: ' + category if category else ''}."
        lines = [f"[{d['category']}] {d['label']}: {d.get('summary', 'No summary')[:200]}"
                 for d in dims[:20]]
        return f"Company Blueprint dimensions:\n" + "\n".join(lines)

    return f"Tool '{tool_name}' result: executed successfully."



# =============================================================
# Attachment processing
# =============================================================

def _process_attachment(att: "Attachment") -> dict:
    """
    Convert an attachment into an Anthropic API content block.

    - PDF       → document block (base64, native Claude reading)
    - Images    → image block (base64, vision)
    - CSV/Excel → text block (converted to markdown table)
    - Other     → text block with filename note
    """
    mime = att.mime_type.lower()
    raw  = base64.b64decode(att.data)

    # ── PDF ──────────────────────────────────────────────────────────────────
    if mime == "application/pdf":
        return {
            "type": "document",
            "source": {
                "type":       "base64",
                "media_type": "application/pdf",
                "data":       att.data,
            },
            "title": att.name,
        }

    # ── Images ────────────────────────────────────────────────────────────────
    if mime.startswith("image/"):
        # Normalise to supported types
        img_type = mime.split("/")[1]
        if img_type not in ("jpeg", "png", "gif", "webp"):
            img_type = "png"
        return {
            "type": "image",
            "source": {
                "type":       "base64",
                "media_type": f"image/{img_type}",
                "data":       att.data,
            },
        }

    # ── CSV / Excel ───────────────────────────────────────────────────────────
    if mime in (
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) or att.name.lower().endswith((".csv", ".xlsx", ".xls")):
        try:
            import pandas as pd
            if att.name.lower().endswith(".csv") or mime == "text/csv":
                df = pd.read_csv(io.BytesIO(raw))
            else:
                df = pd.read_excel(io.BytesIO(raw))
            # Cap to 200 rows to avoid context bloat
            cap   = 200
            total = len(df)
            note  = f" (showing first {cap} of {total} rows)" if total > cap else ""
            table = df.head(cap).to_markdown(index=False)
            return {
                "type": "text",
                "text": f"**Attachment: {att.name}**{note}\n\n{table}",
            }
        except Exception as e:
            return {
                "type": "text",
                "text": f"**Attachment: {att.name}** (could not parse: {str(e)[:100]})",
            }

    # ── Plain text ────────────────────────────────────────────────────────────
    if mime.startswith("text/"):
        try:
            text_content = raw.decode("utf-8", errors="replace")[:10000]
            return {
                "type": "text",
                "text": f"**Attachment: {att.name}**\n\n```\n{text_content}\n```",
            }
        except Exception:
            pass

    # ── Fallback ──────────────────────────────────────────────────────────────
    return {
        "type": "text",
        "text": f"**Attachment: {att.name}** (type: {mime} — cannot display inline)",
    }


def _build_user_content(text_message: str, attachments: list["Attachment"]) -> list[dict] | str:
    """
    Build the user content block for the Anthropic API.
    Returns a string if no attachments, or a list of content blocks.
    """
    if not attachments:
        return text_message

    blocks: list[dict] = []

    # Add attachments first so Claude sees them before the question
    for att in attachments:
        blocks.append(_process_attachment(att))

    # Add the text message last
    if text_message.strip():
        blocks.append({"type": "text", "text": text_message})

    return blocks


async def _fetch_company_dims(company_id: str, db: AsyncSession) -> list[dict]:
    """Fetch dimension nodes for the active company."""
    if not company_id:
        return []
    try:
        rows = await db.execute(
            text("""
                SELECT n.label, t.category, n.summary
                FROM twin.dim_node n
                JOIN twin.dim_type t ON t.id = n.dim_type_id
                WHERE n.company_id = :cid AND n.valid_to IS NULL
                ORDER BY t.category, n.label
                LIMIT 30
            """),
            {"cid": company_id},
        )
        return [{"label": r.label, "category": r.category, "summary": r.summary}
                for r in rows]
    except Exception:
        return []


async def _run_agent_loop(
    config: SessionConfig,
    history: list[dict],
    user_message: str,
    company_dims: list[dict],
    api_key: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    """
    Run the Claude agent loop with tool calling.
    Returns (final_text_response, total_tokens_used).
    Handles multiple tool call rounds automatically.
    """
    tools = _build_tools(config, company_dims)

    # Build message history
    user_content = _build_user_content(user_message, attachments or [])
    messages = [
        *history,
        {"role": "user", "content": user_content},
    ]

    total_tokens = 0
    final_text   = ""
    max_rounds   = 5  # safety cap on tool call rounds

    async with httpx.AsyncClient(timeout=120.0) as client:
        for round_num in range(max_rounds):
            payload: dict[str, Any] = {
                "model":       config.model,
                "max_tokens":  config.max_tokens,
                "temperature": config.temperature,
                "system":      config.system_prompt,
                "messages":    messages,
            }
            if tools:
                payload["tools"] = tools

            resp = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key":         api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json=payload,
            )

            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Anthropic API error {resp.status_code}: {resp.text[:400]}"
                )

            data = resp.json()
            stop_reason  = data.get("stop_reason")
            total_tokens += (data.get("usage", {}).get("input_tokens", 0) +
                             data.get("usage", {}).get("output_tokens", 0))

            # Collect text from this turn
            turn_text = " ".join(
                b["text"] for b in data.get("content", [])
                if b.get("type") == "text"
            ).strip()
            if turn_text:
                final_text = turn_text   # keep the latest non-empty text

            # If done — return
            if stop_reason == "end_turn" or stop_reason == "stop_sequence":
                break

            # If tool use — handle and continue
            if stop_reason == "tool_use":
                tool_results = []
                for block in data.get("content", []):
                    if block.get("type") == "tool_use":
                        result = _handle_tool_call(
                            block["name"],
                            block.get("input", {}),
                            company_dims,
                        )
                        tool_results.append({
                            "type":        "tool_result",
                            "tool_use_id": block["id"],
                            "content":     result,
                        })

                if not tool_results:
                    break

                # Add assistant turn + tool results to messages and loop
                messages.append({"role": "assistant", "content": data["content"]})
                messages.append({"role": "user",      "content": tool_results})
                continue

            # max_tokens or other stop — return what we have
            break

    return final_text or "[No response generated]", total_tokens


def _openai_attachment_to_text(att: "Attachment") -> str:
    mime = att.mime_type.lower()
    raw = base64.b64decode(att.data)

    if mime.startswith("text/"):
        text_content = raw.decode("utf-8", errors="replace")[:10000]
        return f"Attachment: {att.name}\n\n{text_content}"
    return f"Attachment: {att.name} (type: {mime}) attached by user."


async def _run_openai_chat(
    config: SessionConfig,
    history: list[dict],
    user_message: str,
    api_key: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    messages = [{"role": "system", "content": config.system_prompt}]
    messages.extend(history)

    extra_attachment_text = ""
    if attachments:
        attachment_chunks = [_openai_attachment_to_text(att) for att in attachments]
        extra_attachment_text = "\n\n" + "\n\n".join(attachment_chunks)

    messages.append({
        "role": "user",
        "content": f"{user_message}{extra_attachment_text}",
    })

    payload: dict[str, Any] = {
        "model": config.model or OPENAI_MODEL_DEFAULT,
        "messages": messages,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API error {resp.status_code}: {resp.text[:400]}",
        )

    data = resp.json()
    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    usage = data.get("usage", {}) or {}
    tokens_used = int(usage.get("total_tokens", 0))

    return content or "[No response generated]", tokens_used

def _azure_openai_settings(config: SessionConfig) -> tuple[str, str, str, str, bool]:
    endpoint = (
        os.getenv("AZURE_AI_FOUNDRY_ENDPOINT", "")
        or os.getenv("AZURE_OPENAI_ENDPOINT", "")
    ).rstrip("/")
    api_key = (
        os.getenv("AZURE_AI_FOUNDRY_KEY", "")
        or os.getenv("AZURE_OPENAI_API_KEY", "")
    )
    api_version = (
        os.getenv("AZURE_AI_FOUNDRY_API_VERSION", "")
        or os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)
    )
    deployment = (
        os.getenv("AZURE_AI_FOUNDRY_DEPLOYMENT", "").strip()
        or os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
        or (config.model or "").strip()
        or OPENAI_MODEL_DEFAULT
    )

    missing = []
    if not endpoint:
        missing.append("AZURE_AI_FOUNDRY_ENDPOINT")
    if not api_key:
        missing.append("AZURE_AI_FOUNDRY_KEY")
    if not deployment:
        missing.append("AZURE_AI_FOUNDRY_DEPLOYMENT")
    if missing:
        raise HTTPException(status_code=500, detail=f"{', '.join(missing)} not configured")

    uses_v1_api = "/api/projects/" in endpoint or api_version.lower() == "v1"
    if uses_v1_api:
        url = f"{endpoint}/openai/v1/chat/completions"
    else:
        url = (
            f"{endpoint}/openai/deployments/{deployment}/chat/completions"
            f"?api-version={api_version}"
        )
    return url, api_key, api_version, deployment, uses_v1_api


@lru_cache(maxsize=1)
def _get_foundry_credential() -> DefaultAzureCredential:
    return DefaultAzureCredential()


def get_foundry_token() -> str:
    try:
        return _get_foundry_credential().get_token("https://ai.azure.com/.default").token
    except Exception as exc:
        if "AADSTS7000215" in str(exc):
            detail = (
                "Azure rejected AZURE_AI_FOUNDRY_CLIENT_SECRET. Set it to the client secret value from "
                "the Entra app registration, not the secret ID, then recreate tavro-api."
            )
        else:
            detail = (
                "Unable to authenticate to Azure AI Foundry with DefaultAzureCredential. "
                "When running locally outside Docker, run `az login`. When running in Docker, "
                "configure AZURE_AI_FOUNDRY_CLIENT_ID, AZURE_AI_FOUNDRY_TENANT_ID, and AZURE_AI_FOUNDRY_CLIENT_SECRET. "
                "In Azure, configure a managed identity with access to the Foundry project."
            )
        raise HTTPException(
            status_code=500,
            detail=detail,
        ) from exc


def _azure_foundry_project_settings(config: SessionConfig) -> tuple[str, str, str, str]:
    endpoint = (
        os.getenv("AZURE_AI_FOUNDRY_ENDPOINT", "")
        or os.getenv("AZURE_OPENAI_ENDPOINT", "")
    ).rstrip("/")
    token = get_foundry_token()
    api_version = (
        os.getenv("AZURE_AI_FOUNDRY_AGENT_API_VERSION", "")
        or os.getenv("AZURE_AI_FOUNDRY_PROJECT_API_VERSION", "")
        or AZURE_FOUNDRY_AGENT_API_VERSION_DEFAULT
    )
    deployment = (
        os.getenv("AZURE_AI_FOUNDRY_DEPLOYMENT", "").strip()
        or os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
        or (config.model or "").strip()
        or OPENAI_MODEL_DEFAULT
    )

    missing = []
    if not endpoint:
        missing.append("AZURE_AI_FOUNDRY_ENDPOINT")
    if not deployment:
        missing.append("AZURE_AI_FOUNDRY_DEPLOYMENT")
    if missing:
        raise HTTPException(status_code=500, detail=f"{', '.join(missing)} not configured")
    if "/api/projects/" not in endpoint:
        raise HTTPException(
            status_code=500,
            detail="AZURE_AI_FOUNDRY_ENDPOINT must be a Foundry project endpoint ending in /api/projects/{project-name}",
        )

    return endpoint, token, api_version, deployment


def _azure_foundry_use_agent_runs() -> bool:
    return (
        os.getenv("AZURE_AI_FOUNDRY_USE_AGENT_RUNS", AZURE_FOUNDRY_USE_AGENT_RUNS_DEFAULT)
        .strip()
        .lower()
        in ("1", "true", "yes", "on")
    )


def _azure_foundry_use_chat_completions() -> bool:
    return (
        os.getenv("AZURE_AI_FOUNDRY_USE_CHAT_COMPLETIONS", AZURE_FOUNDRY_USE_CHAT_COMPLETIONS_DEFAULT)
        .strip()
        .lower()
        in ("1", "true", "yes", "on")
    )


def _azure_agent_resource_name(agent_name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9-]+", "-", agent_name.strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    if not normalized:
        normalized = "tavro-agent"
    if len(normalized) > 63:
        normalized = normalized[:63].strip("-")
    return normalized or "tavro-agent"


def _azure_agent_headers(token: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Foundry-Features": "HostedAgents=V1Preview",
        "Authorization": f"Bearer {token}",
    }


def _azure_foundry_auth_hint(status_code: int) -> str:
    if status_code not in (401, 403):
        return ""
    return (
        " Azure Foundry rejected the DefaultAzureCredential identity. Make sure it has access "
        "to this Foundry project."
    )


async def _provision_azure_foundry_agent(config: SessionConfig) -> AzureFoundryAgentProvisioning:
    endpoint, token, api_version, deployment = _azure_foundry_project_settings(config)
    agent_name = _azure_agent_resource_name(config.agent_name)
    description = (
        f"Tavro playground agent for {config.use_case_title or config.agent_name}"
    )[:512]
    payload = {
        "name": agent_name,
        "description": description,
        "definition": {
            "kind": "prompt",
            "model": deployment,
            "instructions": config.system_prompt,
        },
        "metadata": {
            "source": "tavro-playground",
            "tavro_agent_name": config.agent_name[:512],
            "tavro_use_case_id": (config.use_case_id or "")[:512],
            "tavro_use_case_title": (config.use_case_title or "")[:512],
        },
    }
    create_url = f"{endpoint}/agents?api-version={api_version}"
    update_url = f"{endpoint}/agents/{agent_name}?api-version={api_version}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            create_url,
            headers=_azure_agent_headers(token),
            json=payload,
        )
        if resp.status_code == 409:
            resp = await client.post(
                update_url,
                headers=_azure_agent_headers(token),
                json=payload,
            )

    if resp.status_code not in (200, 201):
        detail = resp.text[:600]
        if resp.status_code in (401, 403):
            detail += _azure_foundry_auth_hint(resp.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Azure Foundry agent provisioning failed {resp.status_code}: {detail}",
        )

    return AzureFoundryAgentProvisioning(
        enabled=True,
        agent_name=agent_name,
        agent=resp.json(),
    )


async def _run_azure_openai_chat(
    config: SessionConfig,
    history: list[dict],
    user_message: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    messages = [{"role": "system", "content": config.system_prompt}]
    messages.extend(history)

    extra_attachment_text = ""
    if attachments:
        attachment_chunks = [_openai_attachment_to_text(att) for att in attachments]
        extra_attachment_text = "\n\n" + "\n\n".join(attachment_chunks)

    messages.append({
        "role": "user",
        "content": f"{user_message}{extra_attachment_text}",
    })

    url, api_key, _, deployment, uses_v1_api = _azure_openai_settings(config)
    payload: dict[str, Any] = {
        "messages": messages,
        "temperature": config.temperature,
    }
    if uses_v1_api:
        payload["model"] = deployment
        payload["max_completion_tokens"] = config.max_tokens
    else:
        payload["max_tokens"] = config.max_tokens

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            url,
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Azure OpenAI API error {resp.status_code}: {resp.text[:400]}",
        )

    data = resp.json()
    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    usage = data.get("usage", {}) or {}
    tokens_used = int(usage.get("total_tokens", 0))

    return content or "[No response generated]", tokens_used


def _azure_foundry_agent_id(azure_agent: dict | None) -> str | None:
    """Return the assistant/agent id required by the Foundry thread-run API."""
    if not azure_agent:
        return None
    agent = azure_agent.get("agent") or {}
    return (
        agent.get("id")
        or agent.get("assistant_id")
        or azure_agent.get("agent_name")
        or agent.get("name")
    )


def _azure_foundry_message_text(
    user_message: str,
    attachments: list["Attachment"] | None = None,
) -> str:
    extra_attachment_text = ""
    if attachments:
        attachment_chunks = [_openai_attachment_to_text(att) for att in attachments]
        extra_attachment_text = "\n\n" + "\n\n".join(attachment_chunks)
    return f"{user_message}{extra_attachment_text}"


def _azure_foundry_metadata(config: SessionConfig, session: dict) -> dict[str, str]:
    return {
        "source": "tavro-playground",
        "tavro_session_id": str(session.get("session_id", ""))[:512],
        "tavro_agent_name": config.agent_name[:512],
        "tavro_agent_resource": _azure_agent_resource_name(config.agent_name)[:512],
        "tavro_use_case_id": (config.use_case_id or "")[:512],
        "tavro_use_case_title": (config.use_case_title or "")[:512],
    }


def _azure_conversation_input_message(role: str, text_value: str) -> dict[str, Any]:
    return {
        "type": "message",
        "role": role,
        "content": text_value,
    }


def _azure_conversation_output_message(
    config: SessionConfig,
    text_value: str,
    item_id: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": text_value,
    }
    if item_id:
        item["id"] = item_id
    return item


async def _ensure_azure_foundry_conversation(config: SessionConfig, session: dict) -> str:
    conversation_id = session.get("azure_foundry_conversation_id")
    if conversation_id:
        return conversation_id

    endpoint, token_or_key, _, _ = _azure_foundry_project_settings(config)
    payload = {"metadata": _azure_foundry_metadata(config, session)}
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{endpoint}/openai/v1/conversations",
            headers=_azure_agent_headers(token_or_key),
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Azure Foundry conversation creation failed {resp.status_code}: {resp.text[:600]}"
                f"{_azure_foundry_auth_hint(resp.status_code)}"
            ),
        )

    data = resp.json()
    conversation_id = data.get("id")
    if not conversation_id:
        raise HTTPException(status_code=502, detail="Azure Foundry conversation did not return an id")
    session["azure_foundry_conversation_id"] = conversation_id
    return conversation_id


async def _append_azure_foundry_conversation_items(
    config: SessionConfig,
    session: dict,
    items: list[dict[str, Any]],
) -> None:
    if not items:
        return

    endpoint, token_or_key, _, _ = _azure_foundry_project_settings(config)
    conversation_id = await _ensure_azure_foundry_conversation(config, session)
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{endpoint}/openai/v1/conversations/{conversation_id}/items",
            headers=_azure_agent_headers(token_or_key),
            json={"items": items[:20]},
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Azure Foundry conversation item creation failed {resp.status_code}: {resp.text[:600]}"
                f"{_azure_foundry_auth_hint(resp.status_code)}"
            ),
        )


def _extract_azure_foundry_text(message: dict[str, Any]) -> str:
    """Extract assistant text from the different content shapes returned by Agents."""
    parts: list[str] = []
    content = message.get("content", [])
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""

    for block in content:
        if not isinstance(block, dict):
            continue
        text_value = block.get("text")
        if isinstance(text_value, str):
            parts.append(text_value)
        elif isinstance(text_value, dict):
            value = text_value.get("value") or text_value.get("text")
            if isinstance(value, str):
                parts.append(value)
        elif block.get("type") in ("text", "output_text"):
            value = block.get("value") or block.get("content")
            if isinstance(value, str):
                parts.append(value)

    return "\n".join(p.strip() for p in parts if p and p.strip()).strip()


def _extract_azure_response_text(response: dict[str, Any]) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in response.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content", []) or []:
            if not isinstance(block, dict):
                continue
            value = block.get("text") or block.get("value")
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return "\n".join(parts).strip()


async def _run_azure_foundry_response(
    config: SessionConfig,
    session: dict,
    user_message: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    """
    Invoke the Foundry agent through the Responses API.
    This matches Foundry Playground behavior: the agent processes the input,
    appends items to the conversation, and produces traceable responses.
    """
    endpoint, token_or_key, _, _ = _azure_foundry_project_settings(config)
    conversation_id = await _ensure_azure_foundry_conversation(config, session)
    agent_name = _azure_agent_resource_name(config.agent_name)
    payload: dict[str, Any] = {
        "input": _azure_foundry_message_text(user_message, attachments),
        "conversation": conversation_id,
        "agent_reference": {
            "type": "agent_reference",
            "name": agent_name,
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{endpoint}/openai/v1/responses",
            headers=_azure_agent_headers(token_or_key),
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Azure Foundry response creation failed {resp.status_code}: {resp.text[:600]}"
                f"{_azure_foundry_auth_hint(resp.status_code)}"
            ),
        )

    data = resp.json()
    session["azure_foundry_conversation_id"] = data.get("conversation", conversation_id)
    session["azure_foundry_last_response_id"] = data.get("id")
    usage = data.get("usage") or {}
    tokens_used = int(
        usage.get("total_tokens")
        or (
            usage.get("input_tokens", 0)
            + usage.get("output_tokens", 0)
            + usage.get("prompt_tokens", 0)
            + usage.get("completion_tokens", 0)
        )
        or 0
    )

    return _extract_azure_response_text(data) or "[No response generated]", tokens_used


async def _run_azure_foundry_agent(
    config: SessionConfig,
    session: dict,
    user_message: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    """
    Run the provisioned Azure AI Foundry Agent through the Agents thread/run API.
    This is what creates Foundry-visible thread/run traces for portal interactions.
    """
    endpoint, token_or_key, api_version, deployment = _azure_foundry_project_settings(config)
    headers = _azure_agent_headers(token_or_key)
    azure_agent = session.get("azure_foundry_agent") or {}
    assistant_id = _azure_foundry_agent_id(azure_agent)
    if not assistant_id:
        provisioned = await _provision_azure_foundry_agent(config)
        azure_agent = provisioned.model_dump()
        session["azure_foundry_agent"] = azure_agent
        assistant_id = _azure_foundry_agent_id(azure_agent)

    if not assistant_id:
        raise HTTPException(status_code=502, detail="Azure Foundry agent id was not returned by provisioning")

    thread_id = session.get("azure_foundry_thread_id")
    message_text = _azure_foundry_message_text(user_message, attachments)
    metadata = {
        "source": "tavro-playground",
        "tavro_session_id": session.get("session_id", "")[:512],
        "tavro_agent_name": config.agent_name[:512],
        "tavro_use_case_id": (config.use_case_id or "")[:512],
    }

    run_payload: dict[str, Any] = {
        "assistant_id": assistant_id,
        "model": deployment,
        "instructions": config.system_prompt,
        "temperature": config.temperature,
        "max_completion_tokens": max(256, int(config.max_tokens or 2048)),
        "metadata": metadata,
    }

    if thread_id:
        run_payload["additional_messages"] = [{"role": "user", "content": message_text}]
        create_run_url = f"{endpoint}/threads/{thread_id}/runs?api-version={api_version}"
    else:
        run_payload["thread"] = {
            "messages": [{"role": "user", "content": message_text}],
            "metadata": metadata,
        }
        create_run_url = f"{endpoint}/threads/runs?api-version={api_version}"

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(create_run_url, headers=headers, json=run_payload)
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Azure Foundry run creation failed {resp.status_code}: {resp.text[:600]}"
                    f"{_azure_foundry_auth_hint(resp.status_code)}"
                ),
            )

        run = resp.json()
        run_id = run.get("id")
        thread_id = run.get("thread_id") or thread_id
        if not run_id or not thread_id:
            raise HTTPException(status_code=502, detail="Azure Foundry run did not return run_id/thread_id")

        session["azure_foundry_thread_id"] = thread_id
        session["azure_foundry_last_run_id"] = run_id

        terminal_statuses = {"completed", "failed", "cancelled", "expired", "incomplete"}
        status = run.get("status", "")
        for _ in range(90):
            if status in terminal_statuses or status == "requires_action":
                break
            await asyncio.sleep(1)
            poll = await client.get(
                f"{endpoint}/threads/{thread_id}/runs/{run_id}?api-version={api_version}",
                headers=headers,
            )
            if poll.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Azure Foundry run polling failed {poll.status_code}: {poll.text[:600]}"
                        f"{_azure_foundry_auth_hint(poll.status_code)}"
                    ),
                )
            run = poll.json()
            status = run.get("status", "")

        if status != "completed":
            last_error = run.get("last_error") or run.get("incomplete_details") or {}
            raise HTTPException(
                status_code=502,
                detail=f"Azure Foundry run ended with status '{status}': {json.dumps(last_error)[:600]}",
            )

        messages_resp = await client.get(
            f"{endpoint}/threads/{thread_id}/messages?api-version={api_version}&order=desc&limit=20",
            headers=headers,
        )
        if messages_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Azure Foundry message retrieval failed {messages_resp.status_code}: {messages_resp.text[:600]}"
                    f"{_azure_foundry_auth_hint(messages_resp.status_code)}"
                ),
            )

    messages = messages_resp.json().get("data", [])
    response_text = ""
    for message in messages:
        if message.get("role") != "assistant":
            continue
        if message.get("run_id") not in (None, run_id):
            continue
        response_text = _extract_azure_foundry_text(message)
        if response_text:
            break

    usage = run.get("usage") or {}
    tokens_used = int(
        usage.get("total_tokens")
        or (usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0))
        or 0
    )

    return response_text or "[No response generated]", tokens_used

BEDROCK_TRACE_LOG_GROUP = "/tavro/bedrock-agent-traces"


def _put_bedrock_trace_log(
    access_key: str,
    secret_key: str,
    region: str,
    agent_id: str,
    session_id: str,
    payload: dict,
) -> None:
    logs_client = boto3.client(
        "logs",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )

    log_stream_name = f"{agent_id}/{session_id}"

    try:
        logs_client.create_log_group(logGroupName=BEDROCK_TRACE_LOG_GROUP)
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
            raise

    try:
        logs_client.create_log_stream(
            logGroupName=BEDROCK_TRACE_LOG_GROUP,
            logStreamName=log_stream_name,
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
            raise

    token = None
    streams = logs_client.describe_log_streams(
        logGroupName=BEDROCK_TRACE_LOG_GROUP,
        logStreamNamePrefix=log_stream_name,
        limit=1,
    ).get("logStreams", [])

    if streams:
        token = streams[0].get("uploadSequenceToken")

    event = {
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "message": json.dumps(payload, default=str),
    }

    kwargs = {
        "logGroupName": BEDROCK_TRACE_LOG_GROUP,
        "logStreamName": log_stream_name,
        "logEvents": [event],
    }

    if token:
        kwargs["sequenceToken"] = token

    logs_client.put_log_events(**kwargs)
# =============================================================
# AWS Bedrock Support
# =============================================================

def _bedrock_settings() -> tuple[str, str, str]:
    """Get AWS Bedrock configuration from environment."""
    access_key = os.getenv("PLAYGROUND_BEDROCK_ACCESS_KEY", "").strip()
    secret_key = os.getenv("PLAYGROUND_BEDROCK_SECRET_KEY", "").strip()
    region = os.getenv("PLAYGROUND_BEDROCK_REGION", AWS_BEDROCK_REGION_DEFAULT).strip()

    missing = []
    if not access_key:
        missing.append("PLAYGROUND_BEDROCK_ACCESS_KEY")
    if not secret_key:
        missing.append("PLAYGROUND_BEDROCK_SECRET_KEY")
    if not region:
        missing.append("PLAYGROUND_BEDROCK_REGION")
    if missing:
        raise HTTPException(status_code=500, detail=f"{', '.join(missing)} not configured for AWS Bedrock")

    return access_key, secret_key, region
async def _ensure_bedrock_agent_session(session: dict) -> str:
    existing = session.get("bedrock_session_id")
    if existing:
        return existing

    session_id = str(uuid.uuid4())
    session["bedrock_session_id"] = session_id
    return session_id

async def _run_bedrock_agent_chat(
    config: SessionConfig,
    session: dict,
    user_message: str,
    bedrock_agent: dict,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int, dict]:
    """
    Invoke Bedrock Agent with tracing enabled.
    Returns response text, tokens used, and trace information.
    """
    access_key, secret_key, region = _bedrock_settings()

    message_text = user_message
    if attachments:
        attachment_chunks = [_openai_attachment_to_text(att) for att in attachments]
        message_text += "\n\n" + "\n\n".join(attachment_chunks)

    agent_id = bedrock_agent.get("agent_id")
    agent_alias_id = bedrock_agent.get("agent_alias_id")

    if not agent_id:
        raise HTTPException(status_code=400, detail="No Bedrock agent ID found")
    if not agent_alias_id:
        raise HTTPException(status_code=400, detail="No Bedrock agent alias ID found")

    bedrock_session_id = await _ensure_bedrock_agent_session(session)

    agent_runtime_client = boto3.client(
        "bedrock-agent-runtime",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )

    try:
        response = agent_runtime_client.invoke_agent(
            agentId=agent_id,
            agentAliasId=agent_alias_id,
            sessionId=bedrock_session_id,
            inputText=message_text,
            enableTrace=True,
        )

        session["bedrock_last_invocation_id"] = response.get("invocationId")

        response_text = ""
        trace_events = []
        logger.debug("SESSION ID: %s", bedrock_session_id)
        logger.debug("AGENT ID: %s", agent_id)
        logger.debug("ALIAS ID: %s", agent_alias_id)
        logger.debug("INVOCATION ID: %s", response.get("invocationId"))

        for event in response.get("completion", []):
            if "chunk" in event:
                chunk = event["chunk"]
                if "bytes" in chunk:
                    response_text += chunk["bytes"].decode("utf-8")

            if "trace" in event:
                trace_events.append(event["trace"])

        if trace_events:
            combined_trace_payload = {
                "agent_id": agent_id,
                "agent_alias_id": agent_alias_id,
                "session_id": bedrock_session_id,
                "event_time": datetime.utcnow().isoformat(),
                "user_input": message_text,
                "response_text": response_text.strip(),
                "trace_event_count": len(trace_events),
                "traces": trace_events,
            }

            logger.debug("COMBINED TRACE EVENT:")
            logger.debug("%s", json.dumps(combined_trace_payload, indent=2, default=str))

            _put_bedrock_trace_log(
                access_key=access_key,
                secret_key=secret_key,
                region=region,
                agent_id=agent_id,
                session_id=bedrock_session_id,
                payload=combined_trace_payload,
            )
        tokens_used = len(message_text.split()) + len(response_text.split())
        session["bedrock_traces"] = trace_events

        return (
            response_text.strip() or "[No response generated]",
            tokens_used,
            {"traces": trace_events},
        )

    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"AWS Bedrock Agent API error: {str(e)[:400]}",
        )

async def _run_bedrock_chat(
    config: SessionConfig,
    history: list[dict],
    user_message: str,
    attachments: list["Attachment"] | None = None,
) -> tuple[str, int]:
    """
    Run model using AWS Bedrock with Converse API (fallback).
    Used when agent is not available. Supports Claude and other foundation models.
    """
    access_key, secret_key, region = _bedrock_settings()

    # Build message history — Converse API requires content as a list of blocks
    messages = []
    for msg in history:
        content = msg["content"]
        if isinstance(content, str):
            content = [{"text": content}]
        messages.append({"role": msg["role"], "content": content})

    # Add user message with attachments
    extra_attachment_text = ""
    if attachments:
        attachment_chunks = [_openai_attachment_to_text(att) for att in attachments]
        extra_attachment_text = "\n\n" + "\n\n".join(attachment_chunks)

    messages.append({
        "role": "user",
        "content": [{"text": f"{user_message}{extra_attachment_text}"}],
    })

    # Create Bedrock client
    bedrock_client = boto3.client(
        "bedrock-runtime",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )

    # Prepare request for Converse API
    model_id = _resolve_bedrock_model(config.model or AWS_BEDROCK_MODEL_DEFAULT)

    def invoke_with_model(model_value: str):
        return bedrock_client.converse(
            modelId=model_value,
            messages=messages,
            system=[{"text": config.system_prompt}],
            inferenceConfig={
                "maxTokens": config.max_tokens,
                "temperature": config.temperature,
            },
        )

    def find_alternate_model_id(primary_model: str) -> str:
        if primary_model.startswith("us."):
            return primary_model[3:]
        if primary_model.startswith("us.openai."):
            return primary_model[3:]
        if primary_model.startswith("openai."):
            return f"us.{primary_model}"
        if "." not in primary_model:
            return f"us.{primary_model}"
        return primary_model

    try:
        response = invoke_with_model(model_id)
    except Exception as e:
        detail = str(e)
        if "provided model identifier is invalid" in detail.lower():
            fallback_model_id = find_alternate_model_id(model_id)
            try:
                response = invoke_with_model(fallback_model_id)
            except Exception as retry_error:
                raise HTTPException(
                    status_code=502,
                    detail=f"AWS Bedrock API error: {str(retry_error)[:400]}",
                )
        else:
            raise HTTPException(
                status_code=502,
                detail=f"AWS Bedrock API error: {detail[:400]}",
            )

    # Extract response text — Converse API returns {"text": "..."} blocks
    content = response.get("output", {}).get("message", {}).get("content", [])
    response_text = ""
    for block in content:
        if "text" in block:
            response_text += block["text"]

    # Get token usage
    usage = response.get("usage", {})
    tokens_used = (
        usage.get("inputTokens", 0) + usage.get("outputTokens", 0)
    )

    return response_text or "[No response generated]", tokens_used


def _get_bedrock_agent_role_arn(access_key: str, secret_key: str, region: str) -> str:
    iam_client = boto3.client(
        "iam",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )

    response = iam_client.get_role(
        RoleName="BedrockAgentRole"
    )

    return response["Role"]["Arn"]

async def _prepare_bedrock_agent(agents_client, agent_id: str) -> None:
    """Wait for NOT_PREPARED, call prepare_agent, then wait for PREPARED."""
    # Wait for the agent to leave CREATING state (up to 30 s)
    for _ in range(15):
        await asyncio.sleep(2)
        resp = agents_client.get_agent(agentId=agent_id)
        status = resp.get("agent", {}).get("agentStatus", "")
        if status in ("NOT_PREPARED", "PREPARED"):
            break
        if status in ("FAILED", "DELETING"):
            raise HTTPException(status_code=502, detail=f"Bedrock agent entered status '{status}' after creation")

    resp = agents_client.get_agent(agentId=agent_id)
    if resp.get("agent", {}).get("agentStatus") == "PREPARED":
        return

    agents_client.prepare_agent(agentId=agent_id)

    # Poll until PREPARED (up to 120 s)
    for _ in range(60):
        await asyncio.sleep(2)
        resp = agents_client.get_agent(agentId=agent_id)
        status = resp.get("agent", {}).get("agentStatus", "")
        if status == "PREPARED":
            return
        if status == "FAILED":
            raise HTTPException(status_code=502, detail="Bedrock agent preparation failed")

    raise HTTPException(status_code=502, detail="Bedrock agent preparation timed out")


def _bedrock_agent_alias_name(agent_name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9-]+", "-", agent_name.strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    if not normalized:
        normalized = "tavro-agent"
    alias_name = f"{normalized}-alias"
    if len(alias_name) > 63:
        alias_name = alias_name[:63].strip("-")
    return alias_name


def _get_or_create_bedrock_agent_alias(agents_client, agent_id: str, alias_name: str) -> tuple[str, dict[str, Any]]:
    response = agents_client.list_agent_aliases(agentId=agent_id)
    for alias in response.get("agentAliasSummaries", []):
        if alias.get("agentAliasName") == alias_name or alias.get("name") == alias_name:
            return alias.get("agentAliasId") or alias.get("id"), alias

    response = agents_client.create_agent_alias(
        agentId=agent_id,
        agentAliasName=alias_name,
        description="Alias for Tavro playground Bedrock agent",
    )
    alias = response.get("agentAlias") or {}
    alias_id = alias.get("agentAliasId") or alias.get("id")
    if not alias_id:
        raise HTTPException(status_code=502, detail="Failed to create Bedrock agent alias")
    return alias_id, alias


async def _provision_bedrock_agent(config: SessionConfig) -> BedrockAgentProvisioning:
    """
    Provision an agent in AWS Bedrock.
    Creates a new agent with the given configuration.
    Only Claude models are supported for Bedrock Agent Runtime (others require inference profiles).
    """
    # Check if model is supported for agent runtime
    model_key = config.model or AWS_BEDROCK_MODEL_DEFAULT
    logger.debug("Creating Bedrock Agent with model: %s", model_key)
    if model_key not in BEDROCK_AGENT_SUPPORTED_MODELS:
        # Model not supported for agent runtime - return disabled
        return BedrockAgentProvisioning(
            enabled=False,
            agent_name=f"unsupported-{model_key}",
        )

    access_key, secret_key, region = _bedrock_settings()

    # Create Bedrock Agents client
    agents_client = boto3.client(
        "bedrock-agent",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )

    agent_name = _azure_agent_resource_name(config.agent_name)  # Reuse naming convention
    description = (
        f"Tavro playground agent for {config.use_case_title or config.agent_name}"
    )[:200]
    # Use agent-supported model ID (no 'us.' prefix)
    model_id = BEDROCK_AGENT_SUPPORTED_MODELS.get(model_key, BEDROCK_AGENT_SUPPORTED_MODELS["claude-3-5-sonnet"])
    logger.debug("Resolved Bedrock model ID: %s", model_id)

    try:
        # Get or create the agent role
        role_arn = _get_bedrock_agent_role_arn(access_key, secret_key, region)

        # Create agent
        response = agents_client.create_agent(
            agentName=agent_name,
            agentResourceRoleArn=role_arn,
            instruction=config.system_prompt,
            foundationModel=model_id,
            description=description,
            tags={
                "source": "tavro-playground",
                "tavro_agent_name": re.sub(r"[^a-zA-Z0-9 _.:/=+\-@]", "-", config.agent_name)[:100],
                "tavro_use_case_id": re.sub(r"[^a-zA-Z0-9 _.:/=+\-@]", "-", config.use_case_id or "")[:100],
                "tavro_use_case_title": re.sub(r"[^a-zA-Z0-9 _.:/=+\-@]", "-", config.use_case_title or "")[:100],
            }
        )

        agent_id = response.get("agent", {}).get("agentId") or response.get("agentId")
        agent_arn = response.get("agent", {}).get("agentArn")

        await _prepare_bedrock_agent(agents_client, agent_id)

        alias_name = _bedrock_agent_alias_name(agent_name)
        alias_id, alias_obj = _get_or_create_bedrock_agent_alias(agents_client, agent_id, alias_name)

        return BedrockAgentProvisioning(
            enabled=True,
            agent_id=agent_id,
            agent_name=agent_name,
            agent_arn=agent_arn,
            agent_session_id=None,
            agent_alias_id=alias_id,
            agent_alias_name=alias_name,
            agent=response.get("agent"),
        )

    except agents_client.exceptions.ConflictException:
        # Agent already exists — update its model/config and re-prepare
        existing = agents_client.list_agents()
        for a in existing.get("agentSummaries", []):
            if a.get("agentName") == agent_name:
                existing_id = a.get("agentId")
                agents_client.update_agent(
                    agentId=existing_id,
                    agentName=agent_name,
                    agentResourceRoleArn=role_arn,
                    foundationModel=model_id,
                    instruction=config.system_prompt,
                    description=description,
                )
                await _prepare_bedrock_agent(agents_client, existing_id)
                updated = agents_client.get_agent(agentId=existing_id)
                alias_name = _bedrock_agent_alias_name(agent_name)
                alias_id, alias_obj = _get_or_create_bedrock_agent_alias(agents_client, existing_id, alias_name)
                return BedrockAgentProvisioning(
                    enabled=True,
                    agent_id=existing_id,
                    agent_name=agent_name,
                    agent_arn=updated.get("agent", {}).get("agentArn"),
                    agent_session_id=str(uuid.uuid4()),
                    agent_alias_id=alias_id,
                    agent_alias_name=alias_name,
                    agent=updated.get("agent"),
                )
        raise HTTPException(status_code=502, detail=f"Bedrock agent '{agent_name}' conflict but could not find existing agent")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"AWS Bedrock agent provisioning failed: {str(e)[:400]}",
        )


async def _provision_bedrock_agent_background(session_id: str, config: SessionConfig) -> None:
    try:
        bedrock_agent = await _provision_bedrock_agent(config)
        session = session_store.get(session_id)
        if session:
            session["bedrock_agent"] = bedrock_agent.model_dump()
            session["updated_at"] = datetime.utcnow().isoformat()
    except Exception as e:
        session = session_store.get(session_id)
        if session:
            session["bedrock_agent"] = BedrockAgentProvisioning(
                enabled=False,
                agent_name=config.agent_name,
                agent={"error": str(e)},
            ).model_dump()
            session["updated_at"] = datetime.utcnow().isoformat()


def _get_aws_account_id(access_key: str, secret_key: str) -> str:
    """Get AWS account ID from STS."""
    try:
        sts_client = boto3.client(
            "sts",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        response = sts_client.get_caller_identity()
        return response["Account"]
    except Exception:
        # Fallback: return a placeholder
        return "000000000000"

# =============================================================

@router.post("/session", status_code=201)
async def create_session(config: SessionConfig, db: AsyncSession = Depends(get_db)):
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    provider = (config.provider or "claude").lower()
    azure_agent = AzureFoundryAgentProvisioning()
    bedrock_agent = BedrockAgentProvisioning()

    if provider in ("azure_foundry", "azure", "azure_openai"):
        azure_agent = await _provision_azure_foundry_agent(config)
    elif provider in ("aws_bedrock", "bedrock", "aws"):
        bedrock_agent = BedrockAgentProvisioning()

    session_store[session_id] = {
        "session_id":  session_id,
        "config":      config.model_dump(),
        "messages":    [],
        "created_at":  now,
        "updated_at":  now,
        "token_total": 0,
        "azure_foundry_agent": azure_agent.model_dump(),
        "bedrock_agent": bedrock_agent.model_dump(),
    }

    if provider in ("azure_foundry", "azure", "azure_openai"):
        await _ensure_azure_foundry_conversation(config, session_store[session_id])
    elif provider in ("aws_bedrock", "bedrock", "aws"):
        asyncio.create_task(_provision_bedrock_agent_background(session_id, config))

    return {
        "session_id": session_id,
        "status": "created",
        "azure_foundry_agent": azure_agent.model_dump(),
        "bedrock_agent": bedrock_agent.model_dump(),
        "azure_foundry_conversation_id": session_store[session_id].get("azure_foundry_conversation_id"),
    }


# =============================================================
# GET /session/{session_id} — get session state
# =============================================================

@router.get("/session/{session_id}")
async def get_session(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# =============================================================
# POST /session/{session_id}/message — send a message
# =============================================================

@router.post("/session/{session_id}/message")
async def send_message(
    session_id: str,
    body:       MessageRequest,
    db:         AsyncSession = Depends(get_db),
):
    
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    config   = SessionConfig(**session["config"])
    provider = (config.provider or "claude").lower()

    # If the user is requesting a PDF, append a strong override to the system
    # prompt so the agent generates clean report content instead of refusing.
    # This creates a one-shot local config — the stored session is NOT modified.
    if _is_pdf_request(body.content):
        config = SessionConfig(**{
            **session["config"],
            "system_prompt": config.system_prompt + _PDF_SYSTEM_INJECT,
        })
    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    elif provider in ("claude", "anthropic"):
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    elif provider in ("azure_foundry", "azure", "azure_openai"):
        api_key = ""
        _azure_foundry_project_settings(config)
    elif provider in ("aws_bedrock", "bedrock", "aws"):
        api_key = ""
        _bedrock_settings()  # Validate AWS credentials are configured
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported playground provider: {config.provider}")

    now         = datetime.utcnow().isoformat()
    user_msg_id = str(uuid.uuid4())

    # Add user message to session
    att_names = [a.name for a in body.attachments] if body.attachments else []
    session["messages"].append({
        "id":              user_msg_id,
        "role":            "user",
        "content":         body.content,
        "timestamp":       now,
        "attachment_names": att_names,
    })

    # Fetch blueprint dims if tool enabled
    company_dims = []
    if config.company_id:
        company_dims = await _fetch_company_dims(config.company_id, db)

    # Build LLM history (last 20 messages, alternating user/assistant)
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in session["messages"][:-1]   # exclude the message we just added
        if m["role"] in ("user", "assistant")
    ][-20:]

    # Run agent loop
    try:
        if provider == "openai":
            response_text, tokens_used = await _run_openai_chat(
                config, history, body.content, api_key, attachments=body.attachments
            )
        elif provider in ("azure_foundry", "azure", "azure_openai"):
            if _azure_foundry_use_agent_runs():
                response_text, tokens_used = await _run_azure_foundry_agent(
                    config, session, body.content, attachments=body.attachments
                )
            elif not _azure_foundry_use_chat_completions():
                response_text, tokens_used = await _run_azure_foundry_response(
                    config, session, body.content, attachments=body.attachments
                )
            else:
                response_text, tokens_used = await _run_azure_openai_chat(
                    config, history, body.content, attachments=body.attachments
                )
        elif provider in ("aws_bedrock", "bedrock", "aws"):
            bedrock_agent = session.get("bedrock_agent", {})

            if bedrock_agent and bedrock_agent.get("agent_id") and bedrock_agent.get("agent_alias_id"):
                response_text, tokens_used, trace_data = await _run_bedrock_agent_chat(
                    config,
                    session,
                    body.content,
                    bedrock_agent,
                    attachments=body.attachments,
                )
                session["bedrock_traces"] = trace_data.get("traces", [])
            else:
                bedrock_error = (bedrock_agent.get("agent") or {}).get("error")

                if bedrock_error:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Bedrock agent provisioning failed: {bedrock_error}",
                    )

                raise HTTPException(
                    status_code=409,
                    detail="Bedrock agent is still being created/prepared. Wait a few seconds and send the message again.",
                )
        else:
            response_text, tokens_used = await _run_agent_loop(
                config, history, body.content, company_dims, api_key,
                attachments=body.attachments,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise_server_error(e)

    # Add assistant message to session
    assistant_msg = {
        "id":        str(uuid.uuid4()),
        "role":      "assistant",
        "content":   response_text,
        "timestamp": datetime.utcnow().isoformat(),
        "tokens":    tokens_used,
    }
    session["messages"].append(assistant_msg)
    session["token_total"] = session.get("token_total", 0) + tokens_used
    session["updated_at"]  = datetime.utcnow().isoformat()

    if provider in ("azure_foundry", "azure", "azure_openai") and _azure_foundry_use_chat_completions():
        await _append_azure_foundry_conversation_items(
            config,
            session,
            [
                _azure_conversation_input_message(
                    "user",
                    _azure_foundry_message_text(body.content, body.attachments),
                ),
                _azure_conversation_output_message(
                    config,
                    response_text,
                    item_id=assistant_msg["id"],
                )
            ],
        )

    return {
        "message":     assistant_msg,
        "token_total": session["token_total"],
        "azure_foundry_conversation_id": session.get("azure_foundry_conversation_id"),
        "azure_foundry_thread_id": session.get("azure_foundry_thread_id"),
        "azure_foundry_last_run_id": session.get("azure_foundry_last_run_id"),
        "azure_foundry_last_response_id": session.get("azure_foundry_last_response_id"),
        "bedrock_agent": session.get("bedrock_agent"),
        "bedrock_session_id": session.get("bedrock_session_id"),
        "bedrock_last_invocation_id": session.get("bedrock_last_invocation_id"),
        "bedrock_traces": session.get("bedrock_traces", []),
    }


# =============================================================
# DELETE /session/{session_id} — end session
# =============================================================

@router.delete("/session/{session_id}", status_code=200)
async def end_session(session_id: str):
    session = session_store.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    msg_count   = len([m for m in session["messages"] if m["role"] != "system"])
    token_total = session.get("token_total", 0)

    bedrock_session_id = session.get("bedrock_session_id")

    if bedrock_session_id:
        try:
            access_key, secret_key, region = _bedrock_settings()

            agent_runtime_client = boto3.client(
                "bedrock-agent-runtime",
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
            )

            bedrock_agent = session.get("bedrock_agent", {})

            if bedrock_agent.get("agent_id") and bedrock_agent.get("agent_alias_id"):
                agent_runtime_client.invoke_agent(
                    agentId=bedrock_agent["agent_id"],
                    agentAliasId=bedrock_agent["agent_alias_id"],
                    sessionId=bedrock_session_id,
                    inputText="end session",
                    endSession=True,
                )

        except Exception as e:
            logger.warning("END_SESSION ERROR: %s", e)
    return {
        "session_id":  session_id,
        "status":      "ended",
        "messages":    msg_count,
        "token_total": token_total,
    }


# =============================================================
# GET /session/{session_id}/summary — AI-generated session summary
# Returns gaps, capabilities, info requirements found during session
# =============================================================

@router.get("/session/{session_id}/summary")
async def get_session_summary(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = [m for m in session["messages"] if m["role"] in ("user", "assistant")]
    if not messages:
        return {"summary": "No conversation to summarise yet."}

    transcript = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages
    )

    config = session["config"]
    provider = (config.get("provider") or "claude").lower()

    prompt = f"""Analyse this agent prototype session and return a structured JSON summary.

Agent: {config.get('agent_name', 'Unknown')}
Session transcript:
{transcript[:6000]}

Return ONLY a JSON object with this structure:
{{
  "overall_assessment": "2-3 sentence overall assessment of the agent prototype",
  "capabilities": ["list of things the agent handled well"],
  "gaps": ["list of gaps or limitations observed"],
  "information_needed": ["information the agent needed but didn't have"],
  "unexpected_behaviours": ["anything surprising or unexpected"],
  "recommended_next_steps": ["concrete next steps to improve this agent"]
}}"""

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OPENAI_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_MODEL_DEFAULT,
                    "max_tokens": 1024,
                    "messages": [
                        {"role": "system", "content": "You are an AI evaluation assistant. Return only valid JSON."},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to generate summary")
        data = resp.json()
        raw = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
    elif provider in ("azure_foundry", "azure", "azure_openai"):
        summary_config = SessionConfig(**config)
        url, api_key, _, deployment, uses_v1_api = _azure_openai_settings(summary_config)
        payload: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": "You are an AI evaluation assistant. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
        }
        if uses_v1_api:
            payload["model"] = deployment
            payload["max_completion_tokens"] = 1024
        else:
            payload["max_tokens"] = 1024
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers={
                    "api-key": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to generate summary")
        data = resp.json()
        raw = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
    else:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key":         api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json={
                    "model":      ANTHROPIC_MODEL_DEFAULT,
                    "max_tokens": 1024,
                    "system":     "You are an AI evaluation assistant. Return only valid JSON.",
                    "messages":   [{"role": "user", "content": prompt}],
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to generate summary")
        data = resp.json()
        raw = " ".join(b["text"] for b in data.get("content", []) if b.get("type") == "text")

    # Strip fences
    import re
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw).strip()

    try:
        return {"summary": json.loads(raw), "token_total": session.get("token_total", 0)}
    except json.JSONDecodeError:
        return {"summary": raw, "token_total": session.get("token_total", 0)}
