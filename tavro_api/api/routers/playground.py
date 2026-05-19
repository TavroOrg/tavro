# =============================================================
# api/routers/playground.py
# Stateful agent playground sessions — Claude managed execution.
# Sessions are held in-memory (suitable for POC / single-instance).
# For multi-instance deployments, replace session_store with Redis.
# =============================================================

import base64
import io
import json
import os
import re
import uuid
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db

router = APIRouter()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-6"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL_DEFAULT = "gpt-4o"

AZURE_OPENAI_API_VERSION_DEFAULT = "2024-02-15-preview"
AZURE_FOUNDRY_AGENT_API_VERSION_DEFAULT = "v1"

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


def _azure_foundry_project_settings(config: SessionConfig) -> tuple[str, str, str, str]:
    endpoint = (
        os.getenv("AZURE_AI_FOUNDRY_ENDPOINT", "")
        or os.getenv("AZURE_OPENAI_ENDPOINT", "")
    ).rstrip("/")
    token = (
        os.getenv("AZURE_AI_FOUNDRY_AGENT_TOKEN", "")
        or os.getenv("AZURE_AI_FOUNDRY_TOKEN", "")
        or os.getenv("AZURE_AI_FOUNDRY_KEY", "")
    )
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
    if not token:
        missing.append("AZURE_AI_FOUNDRY_AGENT_TOKEN or AZURE_AI_FOUNDRY_KEY")
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


def _azure_agent_resource_name(agent_name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9-]+", "-", agent_name.strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    if not normalized:
        normalized = "tavro-agent"
    if len(normalized) > 63:
        normalized = normalized[:63].strip("-")
    return normalized or "tavro-agent"


def _azure_agent_headers(token_or_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token_or_key.count(".") >= 2:
        headers["Authorization"] = f"Bearer {token_or_key}"
    else:
        headers["api-key"] = token_or_key
    return headers


async def _provision_azure_foundry_agent(config: SessionConfig) -> AzureFoundryAgentProvisioning:
    endpoint, token_or_key, api_version, deployment = _azure_foundry_project_settings(config)
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
            headers=_azure_agent_headers(token_or_key),
            json=payload,
        )
        if resp.status_code == 409:
            resp = await client.post(
                update_url,
                headers=_azure_agent_headers(token_or_key),
                json=payload,
            )

    if resp.status_code not in (200, 201):
        detail = resp.text[:600]
        if resp.status_code in (401, 403):
            detail += (
                " The Foundry Agents API usually requires an Entra token with "
                "Azure AI User access. Set AZURE_AI_FOUNDRY_AGENT_TOKEN from "
                "`az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv`."
            )
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

# =============================================================
# POST /session — create a new session
# =============================================================

@router.post("/session", status_code=201)
async def create_session(config: SessionConfig, db: AsyncSession = Depends(get_db)):
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    provider = (config.provider or "claude").lower()
    azure_agent = AzureFoundryAgentProvisioning()

    if provider in ("azure_foundry", "azure", "azure_openai"):
        azure_agent = await _provision_azure_foundry_agent(config)

    session_store[session_id] = {
        "session_id":  session_id,
        "config":      config.model_dump(),
        "messages":    [],
        "created_at":  now,
        "updated_at":  now,
        "token_total": 0,
        "azure_foundry_agent": azure_agent.model_dump(),
    }

    return {"session_id": session_id, "status": "created", "azure_foundry_agent": azure_agent.model_dump()}


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

    config      = SessionConfig(**session["config"])
    provider = (config.provider or "claude").lower()
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
        _azure_openai_settings(config)
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
            response_text, tokens_used = await _run_azure_openai_chat(
                config, history, body.content, attachments=body.attachments
            )
        else:
            response_text, tokens_used = await _run_agent_loop(
                config, history, body.content, company_dims, api_key,
                attachments=body.attachments,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

    return {
        "message":     assistant_msg,
        "token_total": session["token_total"],
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
