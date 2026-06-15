from __future__ import annotations
import base64
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.blueprint import (
    _call_anthropic,
    _call_openai,
    _collect_text,
    _extract_json,
)

router = APIRouter()

CORE    = os.getenv("CORE_DB_NAME")
CURATED = os.getenv("CURATED_DB_NAME")
RISK    = os.getenv("RISK_MANAGEMENT_DB_NAME")
_RISK_URL = os.getenv("RISK_CLASSIFY_URL")


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None

def _resolve_agent_llm() -> tuple[str, str]:
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if anthropic_key:
        return "anthropic", anthropic_key

    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        return "openai", openai_key

    raise HTTPException(
        status_code=500,
        detail="No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.",
    )


def _require_tenant(request: Request) -> str:
    tenant_id = _tenant(request)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing tenant context.")
    return tenant_id


def _risk_payload(agent_internal_id: str, agent_id: str, agent_name: str,
                  description: str, instruction: str, tenant_id: Optional[str]) -> Dict[str, Any]:
    return {
        "agent_internal_id": agent_internal_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_description": description,
        "agent_instructions": instruction or "",
        "agent_role": "",
        "provider": "Portal",
        "agent_platform": "",
        "tenant_id": tenant_id,
        "attack_vector_av": "N",
        "attack_complexity_ac": "L",
        "attack_requirements_at": "P",
        "privileges_required_pr": "L",
        "user_interaction_ui": "P",
        "vulnerable_system_confidentiality_vc": "L",
        "vulnerable_system_integrity_vi": "L",
        "vulnerable_system_availability_va": "L",
        "subsequent_system_confidentiality_sc": "L",
        "subsequent_system_integrity_si": "L",
        "subsequent_system_availability_sa": "L",
    }


async def _fire_risk(payload: Dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            await client.post(_RISK_URL, json=payload)
    except Exception as e:
        print(f"[risk-trigger] {e}")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AgentCreateRequest(BaseModel):
    agent_name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    instruction: str
    role: Optional[str] = None
    environment: Optional[str] = None
    owner: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None
    tables: Optional[List[Dict[str, Any]]] = None
    data_source: Optional[List[Dict[str, Any]]] = None
    knowledge_source: Optional[Dict[str, str]] = None
    skills: Optional[List[Dict[str, Any]]] = None


class AgentUpdateRequest(BaseModel):
    agent_name: Optional[str] = None
    description: Optional[str] = None
    instruction: Optional[str] = None
    skills: Optional[List[Any]] = None


class AgentAttachmentCreate(BaseModel):
    filename: str
    mime_type: str
    content_base64: str


_AGENT_ATTACHMENTS_READY = False


async def _ensure_agent_attachments_table(db: AsyncSession) -> None:
    global _AGENT_ATTACHMENTS_READY
    if _AGENT_ATTACHMENTS_READY:
        return

    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.agent_attachment (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mime_type TEXT,
                file_size_bytes INT NOT NULL,
                file_data BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS agent_attachment_agent_idx
            ON public.agent_attachment (agent_id, created_at DESC)
            """
        )
    )
    await db.commit()
    _AGENT_ATTACHMENTS_READY = True

class SuggestAgentDescriptionRequest(BaseModel):
    agent_name: str


class SuggestAgentDescriptionResponse(BaseModel):
    description: str


SUGGEST_AGENT_DESCRIPTION_SYSTEM = """You are helping a user create an AI agent in Tavro.

Given only an agent name, generate a short plain-text description of what the agent likely does.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Be specific and practical, but do not invent implementation details, integrations, or company-specific facts.
- Focus on the agent's likely purpose, users, and business value based on the name alone.
- Do not assume a specific technical approach such as machine learning, LLMs, OCR, NLP, real-time processing, APIs, or automation patterns unless that is explicit in the name.
- If the name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence agent description"
}"""


# ---------------------------------------------------------------------------
# GET /  — catalog
# ---------------------------------------------------------------------------

@router.get("/", summary="Get Agent Catalog")
async def get_agent_catalog(
    request: Request,
    start_record: int = 1,
    record_range: str = "1-50",
    company_id: Optional[str] = Query(default=None, description="Filter by company UUID"),
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 49

    tenant_id = _require_tenant(request)
    params: Dict[str, Any] = {"tid": tenant_id}
    where_parts = ["(a.tenant_id = :tid OR a.tenant_id IS NULL)"]

    cid = company_id.strip() if company_id and company_id.strip() else None
    if cid:
        try:
            col_check = await db.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                    LIMIT 1
                """),
                {"schema": CURATED, "tbl": "agent_360"},
            )
            if col_check.first():
                where_parts.append("(CAST(a.company_id AS text) = :company_id OR a.company_id IS NULL OR CAST(a.company_id AS text) = '')")
                params["company_id"] = cid
        except Exception:
            pass

    where = "WHERE " + " AND ".join(where_parts)

    try:
        result = await db.execute(
            text(f"""
                SELECT *, ROW_NUMBER() OVER () AS rn, COUNT(*) OVER () AS total_records
                FROM (
                    SELECT * FROM {CURATED}.agent_360 a
                    {where}
                ) t
            """),
            params,
        )
        rows = result.mappings().all()

        # When a company_id filter is active, supplement curated results with any
        # matching agents from core.agents not yet synced to the curated table.
        curated_agent_ids: set = {r["agent_id"] for r in rows} if cid else set()
        extra_rows: list = []
        if cid and curated_agent_ids is not None:
            try:
                core_col = await db.execute(
                    text("""
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                        LIMIT 1
                    """),
                    {"schema": CORE, "tbl": "agents"},
                )
                if core_col.first():
                    extra_result = await db.execute(
                        text(f"""
                            SELECT
                                a.agent_id, a.agent_internal_id, a.agent_name AS agent_name,
                                a.agent_description, a.tenant_id, a.company_id,
                                a.created_ts, a.updated_ts
                            FROM {CORE}.agents a
                            WHERE (a.tenant_id = :tid OR a.tenant_id IS NULL)
                              AND a.is_current = true
                              AND CAST(a.company_id AS text) = :company_id
                        """),
                        {"tid": tenant_id, "company_id": cid},
                    )
                    for r in extra_result.mappings().all():
                        if r["agent_id"] not in curated_agent_ids:
                            extra_rows.append(dict(r))
            except Exception:
                pass

        # Combine curated rows with any unsynchronised core rows
        all_raw = [dict(r) for r in rows] + extra_rows
        total = len(all_raw)
        data = [{k: v for k, v in r.items() if k not in ("rn", "total_records")}
                for i, r in enumerate(all_raw, start=1)
                if start <= i <= end]
        return {"start_record": start, "end_record": end, "record_count": len(data),
                "total_records": total, "data": data}
    except Exception:
        pass

    # Fallback to core.agents if curated.agent_360 fails entirely (e.g. TOAST corruption)
    try:
        core_where_parts = ["(a.tenant_id = :tid OR a.tenant_id IS NULL)", "a.is_current = true"]
        core_params: Dict[str, Any] = {"tid": tenant_id}
        if cid:
            try:
                col_check2 = await db.execute(
                    text("""
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                        LIMIT 1
                    """),
                    {"schema": CORE, "tbl": "agents"},
                )
                if col_check2.first():
                    core_where_parts.append("CAST(a.company_id AS text) = :company_id")
                    core_params["company_id"] = cid
            except Exception:
                pass

        core_where = "WHERE " + " AND ".join(core_where_parts)
        result2 = await db.execute(
            text(f"""
                SELECT
                    a.agent_id, a.agent_internal_id, a.agent_name, a.agent_description,
                    a.tenant_id, a.created_ts, a.updated_ts,
                    ROW_NUMBER() OVER () AS rn, COUNT(*) OVER () AS total_records
                FROM {CORE}.agents a
                {core_where}
            """),
            core_params,
        )
        rows2 = result2.mappings().all()
        total2 = int(rows2[0]["total_records"]) if rows2 else 0
        data2 = [{k: v for k, v in r.items() if k not in ("rn", "total_records")} for r in rows2
                 if start <= r["rn"] <= end]
        return {"start_record": start, "end_record": end, "record_count": len(data2),
                "total_records": total2, "data": data2}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _agent_card_dir() -> Path:
    return Path(os.getenv("LOCAL_AGENT_CARD_DIR", "./agent_cards"))


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _column_names(raw_columns: Any) -> List[str]:
    if not raw_columns:
        return []
    if isinstance(raw_columns, str):
        raw_columns = [raw_columns]
    if not isinstance(raw_columns, list):
        return []

    names: List[str] = []
    seen: set[str] = set()
    for col in raw_columns:
        if isinstance(col, dict):
            name = _clean_text(col.get("name") or col.get("column_name") or col.get("identifier"))
        else:
            name = _clean_text(col)
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def _table_items(raw_tables: Any) -> List[Dict[str, Any]]:
    if not raw_tables:
        return []
    if isinstance(raw_tables, dict):
        raw_tables = [raw_tables]
    elif isinstance(raw_tables, str):
        raw_tables = [{"name": raw_tables}]
    if not isinstance(raw_tables, list):
        return []

    tables: List[Dict[str, Any]] = []
    for raw in raw_tables:
        if isinstance(raw, str):
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        tables.append({
            "table_id": _clean_text(raw.get("table_id") or raw.get("id") or raw.get("identifier")),
            "name": _clean_text(raw.get("name") or raw.get("table_name")),
            "columns": _column_names(raw.get("columns") or raw.get("column")),
            "tool_name": _clean_text(raw.get("tool_name") or raw.get("tool")),
            "tool_id": _clean_text(raw.get("tool_id")),
        })
    return tables


def _tables_from_tools(tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        tool_name = _clean_text(tool.get("name"))
        tool_tables = _table_items(tool.get("tables") or tool.get("table"))

        # Also support the compact shape:
        # { "name": "create_incident", "columns": ["id", "status"] }
        if not tool_tables and tool.get("columns"):
            tool_tables = [{
                "table_id": None,
                "name": _clean_text(tool.get("table_name")) or (f"{tool_name} table" if tool_name else None),
                "columns": _column_names(tool.get("columns")),
                "tool_name": tool_name,
                "tool_id": None,
            }]

        for table in tool_tables:
            table["tool_name"] = table.get("tool_name") or tool_name
            tables.append(table)
    return tables


def _tables_from_data_sources(data_sources: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    table_map: Dict[str, Dict[str, Any]] = {}
    for entry in data_sources or []:
        if not isinstance(entry, dict):
            continue
        src_type = str(entry.get("source_object_type") or "").lower()
        tgt_type = str(entry.get("target_object_type") or "").lower()
        if src_type == "table" and tgt_type == "column":
            table_id = _clean_text(entry.get("source_object_id"))
            if not table_id:
                continue
            item = table_map.setdefault(
                table_id,
                {
                    "table_id": table_id,
                    "name": _clean_text(entry.get("source_object_name")),
                    "columns": [],
                    "tool_name": None,
                    "tool_id": None,
                },
            )
            column_name = _clean_text(entry.get("target_object_name") or entry.get("target_object_id"))
            if column_name and column_name not in item["columns"]:
                item["columns"].append(column_name)
        elif src_type == "agent" and tgt_type == "table":
            table_id = _clean_text(entry.get("target_object_id"))
            if not table_id:
                continue
            item = table_map.setdefault(
                table_id,
                {
                    "table_id": table_id,
                    "name": _clean_text(entry.get("target_object_name")),
                    "columns": [],
                    "tool_name": None,
                    "tool_id": None,
                },
            )
            item["name"] = item.get("name") or _clean_text(entry.get("target_object_name"))
        elif src_type == "tool" and tgt_type == "table":
            table_id = _clean_text(entry.get("target_object_id"))
            if not table_id:
                continue
            item = table_map.setdefault(
                table_id,
                {
                    "table_id": table_id,
                    "name": _clean_text(entry.get("target_object_name")),
                    "columns": [],
                    "tool_name": None,
                    "tool_id": None,
                },
            )
            item["tool_id"] = _clean_text(entry.get("source_object_id"))
            item["tool_name"] = _clean_text(entry.get("source_object_name"))
            item["name"] = item.get("name") or _clean_text(entry.get("target_object_name"))
    return list(table_map.values())


def _normalize_tables_payload(
    tables: Any,
    tools: Optional[List[Dict[str, Any]]],
    data_sources: Optional[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    normalized: Dict[str, Dict[str, Any]] = {}
    for table in [
        *_table_items(tables),
        *_tables_from_tools(tools),
        *_tables_from_data_sources(data_sources),
    ]:
        raw_table_id = table.get("table_id")
        table_name = table.get("name")
        if raw_table_id:
            key = f"id:{raw_table_id}"
        elif table_name:
            key = f"name:{str(table_name).strip().lower()}"
        else:
            key = f"anonymous:{len(normalized)}"
        item = normalized.setdefault(
            key,
            {
                "table_id": raw_table_id,
                "name": table_name,
                "columns": [],
                "tool_name": table.get("tool_name"),
                "tool_id": table.get("tool_id"),
            },
        )
        item["table_id"] = item.get("table_id") or raw_table_id
        item["name"] = table_name or item.get("name")
        item["tool_name"] = table.get("tool_name") or item.get("tool_name")
        item["tool_id"] = table.get("tool_id") or item.get("tool_id")
        existing_columns = {str(col).strip().lower() for col in item["columns"]}
        for column_name in table.get("columns") or []:
            column_key = str(column_name).strip().lower()
            if column_key and column_key not in existing_columns:
                item["columns"].append(column_name)
                existing_columns.add(column_key)

    for item in normalized.values():
        item["table_id"] = item.get("table_id") or str(uuid.uuid4())
    return list(normalized.values())


def _list_text_values(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        if "," in stripped:
            return [part.strip() for part in stripped.split(",") if part.strip()]
        return [stripped]
    return []


def _first_present(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _has_any_key(mapping: Dict[str, Any], *keys: str) -> bool:
    return any(key in mapping for key in keys)


def _skill_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_existing_skill_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for row in rows:
        skill_id = _skill_text(row.get("skill_id") or row.get("identifier") or row.get("id"))
        if not skill_id:
            continue
        skill_name = _skill_text(row.get("name") or row.get("skill_name") or skill_id)
        entries.append({
            "skill_id": skill_id,
            "skill_name": skill_name,
            "description": _skill_text(row.get("description")),
            "tags": _list_text_values(row.get("tags")),
            "input_modes": _list_text_values(row.get("input_modes") or row.get("inputModes")),
            "output_modes": _list_text_values(row.get("output_modes") or row.get("outputModes")),
        })
    return entries


def _find_existing_skill(
    existing: List[Dict[str, Any]],
    *,
    explicit_id: str,
    skill_name: str,
    single_skill_patch: bool,
) -> Optional[Dict[str, Any]]:
    explicit_key = explicit_id.lower()
    name_key = skill_name.lower()
    for row in existing:
        if explicit_key and row["skill_id"].lower() == explicit_key:
            return row
    for row in existing:
        candidates = {row["skill_id"].lower(), row["skill_name"].lower()}
        if name_key and name_key in candidates:
            return row
    if single_skill_patch and len(existing) == 1:
        return existing[0]
    return None


def _normalize_skill_entries(
    skills: Optional[List[Any]],
    existing: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    seen_skill_ids: set[str] = set()
    existing_entries = _normalize_existing_skill_rows(existing or [])
    single_skill_patch = len(skills or []) == 1

    for skill in (skills or []):
        existing_match: Optional[Dict[str, Any]] = None
        if isinstance(skill, str):
            skill_id = _skill_text(skill)
            skill_name = skill_id
            existing_match = _find_existing_skill(
                existing_entries,
                explicit_id=skill_id,
                skill_name=skill_name,
                single_skill_patch=single_skill_patch,
            )
            if existing_match:
                skill_id = existing_match["skill_id"]
                skill_name = existing_match["skill_name"]
                skill_desc = existing_match["description"]
                tags = existing_match["tags"]
                input_modes = existing_match["input_modes"]
                output_modes = existing_match["output_modes"]
            else:
                skill_desc = ""
                tags = []
                input_modes = []
                output_modes = []
        elif isinstance(skill, dict):
            explicit_id = _skill_text(_first_present(skill, "identifier", "skill_id", "id"))
            requested_name = _skill_text(skill.get("name") or skill.get("skill_name"))
            fallback_name = requested_name or _skill_text(skill.get("name")) or explicit_id
            existing_match = _find_existing_skill(
                existing_entries,
                explicit_id=explicit_id,
                skill_name=fallback_name,
                single_skill_patch=single_skill_patch,
            )
            skill_id = existing_match["skill_id"] if existing_match else (explicit_id or fallback_name)
            skill_name = requested_name or (existing_match["skill_name"] if existing_match else skill_id)
            skill_desc = (
                _skill_text(skill.get("description"))
                if "description" in skill
                else (existing_match["description"] if existing_match else "")
            )
            tags = (
                _list_text_values(skill.get("tags"))
                if "tags" in skill
                else (existing_match["tags"] if existing_match else [])
            )
            input_modes = (
                _list_text_values(_first_present(
                    skill, "inputModes", "input_modes", "inputBounds", "input_bounds", "inputs", "input"
                ))
                if _has_any_key(skill, "inputModes", "input_modes", "inputBounds", "input_bounds", "inputs", "input")
                else (existing_match["input_modes"] if existing_match else [])
            )
            output_modes = (
                _list_text_values(_first_present(
                    skill, "outputModes", "output_modes", "outputBounds", "output_bounds", "outputs", "output"
                ))
                if _has_any_key(skill, "outputModes", "output_modes", "outputBounds", "output_bounds", "outputs", "output")
                else (existing_match["output_modes"] if existing_match else [])
            )
        else:
            continue

        if not skill_id:
            continue
        skill_key = skill_id.lower()
        if skill_key in seen_skill_ids:
            continue
        seen_skill_ids.add(skill_key)
        entries.append({
            "skill_id": skill_id,
            "skill_name": skill_name,
            "description": skill_desc,
            "tags": tags,
            "input_modes": input_modes,
            "output_modes": output_modes,
        })

    return entries


def _write_agent_card(
    agent_id: str,
    agent_internal_id: str,
    agent_name: str,
    description: str,
    instruction: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    knowledge_source: Optional[Dict[str, str]] = None,
    tables: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Write a full agent card JSON file immediately after creation so get_agent_card returns complete details."""
    try:
        card_dir = _agent_card_dir()
        card_dir.mkdir(parents=True, exist_ok=True)

        tool_entries = []
        data_source_entries = []
        if tools:
            for tool in tools:
                tool_id = tool.get("identifier") or str(uuid.uuid4())
                tool_entries.append({
                    "identifier": tool_id,
                    "name": tool.get("name"),
                    "description": tool.get("description"),
                    "delegation_possible": None,
                    "allowed_delegates": None,
                    "parameter_name": None,
                    "parameter_type": None,
                    "default_value": None,
                    "input_schema": None,
                    "output_schema": None,
                })
                data_source_entries.append({
                    "relationship_id": None,
                    "parent_relationship_id": None,
                    "source_object_id": agent_id,
                    "source_object_domain": None,
                    "source_object_name": agent_name,
                    "source_object_type": "Agent",
                    "target_object_id": tool_id,
                    "target_object_domain": None,
                    "target_object_name": tool.get("name"),
                    "target_object_type": "Tool",
                    "access_level": None,
                    "uses_pii": None,
                    "uses_phi": None,
                    "uses_pci": None,
                })

        for table in tables or []:
            table_id = table.get("table_id")
            table_name = table.get("name")
            if not table_id:
                continue
            data_source_entries.append({
                "relationship_id": None,
                "parent_relationship_id": None,
                "source_object_id": table.get("tool_id") or agent_id,
                "source_object_domain": None,
                "source_object_name": table.get("tool_name") or agent_name,
                "source_object_type": "Tool" if table.get("tool_id") else "Agent",
                "target_object_id": table_id,
                "target_object_domain": None,
                "target_object_name": table_name,
                "target_object_type": "Table",
                "access_level": None,
                "uses_pii": None,
                "uses_phi": None,
                "uses_pci": None,
            })
            for column_name in table.get("columns") or []:
                col_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{table_id}:{column_name}"))
                data_source_entries.append({
                    "relationship_id": None,
                    "parent_relationship_id": None,
                    "source_object_id": table_id,
                    "source_object_domain": None,
                    "source_object_name": table_name,
                    "source_object_type": "Table",
                    "target_object_id": col_id,
                    "target_object_domain": None,
                    "target_object_name": column_name,
                    "target_object_type": "Column",
                    "access_level": None,
                    "uses_pii": None,
                    "uses_phi": None,
                    "uses_pci": None,
                })

        ks_entry = None
        if knowledge_source:
            ks_entry = {
                "identifier": None,
                "name": knowledge_source.get("name"),
                "access_mechanism": None,
            }

        skill_entries = []
        for s in (skills or []):
            if isinstance(s, str):
                skill_entries.append({"identifier": s, "name": s, "description": None, "tags": [], "inputModes": [], "outputModes": []})
            elif isinstance(s, dict):
                skill_id = s.get("identifier") or s.get("skill_id") or s.get("id") or s.get("name") or ""
                skill_entries.append({
                    "identifier": skill_id,
                    "name": s.get("name") or s.get("skill_name") or skill_id,
                    "description": s.get("description"),
                    "tags": s.get("tags") if isinstance(s.get("tags"), list) else [],
                    "inputModes": s.get("inputModes") or s.get("input_modes") or [],
                    "outputModes": s.get("outputModes") or s.get("output_modes") or [],
                })

        card = {
            "capabilities": {"streaming": False},
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
            "name": agent_name,
            "description": description,
            "preferredTransport": None,
            "protocol_version": None,
            "instruction_sets": [],
            "skills": skill_entries,
            "provider": {"organization": None, "url": ""},
            "url": "",
            "documentation_url": None,
            "icon_url": None,
            "security": None,
            "security_schemes": None,
            "signatures": None,
            "supports_authenticated_extended_card": None,
            "additional_interfaces": None,
            "version": "1.0",
            "identification": {
                "agent_id": agent_id,
                "agent_internal_id": agent_internal_id,
                "goal_orientation": None,
                "role": None,
                "instruction": instruction,
                "owner": None,
                "environment": None,
                "tags": None,
                "governance_status": "Risk Assessment is running",
                "reviewer": None,
                "cost_center": None,
            },
            "configuration": {
                "access_scope": None,
                "memory_type": None,
                "data_freshness_policy": None,
                "autonomy_level": None,
                "reasoning_model": None,
            },
            "ai_use_case": [{"identifier": None, "name": None, "description": None, "proposed_by": None, "owner": None, "business_function": None, "problem_statement": None, "expected_benefits": None, "priority": None, "status": None}],
            "application": [{"identifier": None, "name": None, "description": None, "business_criticality": None, "emergency_tier": None}],
            "ai_model": [{"name": None, "owner": None, "department_executive": None, "description": None}],
            "business_process": [{"identifier": None, "name": None, "description": None, "business_criticality": None}],
            "physical_ai": [{"identifier": None, "name": None, "type": None, "sensory_input_source": None}],
            "llm_model": [{"name": None, "version_number": None}],
            "guardrail": {"name": None, "description": None, "model": None},
            "mcp_server": {"name": None, "url": None, "version_number": None},
            "tool": tool_entries,
            "data_source": data_source_entries,
            "knowledge_source": ks_entry,
            "prompt_template": {"identifier": None, "name": None, "description": None},
            "memory": {"identifier": None, "name": None, "type": None},
            "regulation_or_framework": {"name": None, "type": None, "regulatory_authority": None, "jurisdiction": None, "requirement": None},
            "control": [{"identifier": None, "name": None, "objective": None, "domain": None}],
            "risk_assessment": None,
        }

        card_path = card_dir / f"{agent_id}_agent_card.json"
        with card_path.open("w", encoding="utf-8") as f:
            json.dump(card, f, indent=2, ensure_ascii=False)
        print(f"[create_agent] Agent card written: {card_path}")

    except Exception as e:
        print(f"[create_agent] Warning: failed to write agent card file: {e}")


# ---------------------------------------------------------------------------
# POST /  — create agent
# ---------------------------------------------------------------------------

@router.post("/", summary="Create Agent", status_code=201)
async def create_agent(
    body: AgentCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    company_id: Optional[str] = Query(default=None),
    company_name: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    agent_id = str(uuid.uuid4())
    agent_internal_id = str(uuid.uuid4())
    tenant_id = _require_tenant(request)
    cid = company_id.strip() if company_id and company_id.strip() else None
    cname = company_name.strip() if company_name and company_name.strip() else None

    try:
        await db.execute(
            text(f"""
                INSERT INTO {CORE}.agents
                    (tenant_id, agent_internal_id, agent_id, agent_name, agent_description,
                     created_ts, updated_ts, is_current, company_id, company_name)
                VALUES
                    (:tid, :iid, :aid, :name, :desc,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true, :cid, :cname)
            """),
            {"tid": tenant_id, "iid": agent_internal_id, "aid": agent_id,
             "name": body.agent_name, "desc": body.description, "cid": cid, "cname": cname},
        )

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.agent_identifications
                    (tenant_id, agent_internal_id, agent_id, instruction,
                     role, environment, governance_status, created_ts, updated_ts, is_current)
                VALUES
                    (:tid, :iid, :aid, :instruction,
                     :role, :environment, 'Risk Assessment is running',
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
            """),
            {"tid": tenant_id, "iid": agent_internal_id, "aid": agent_id,
             "instruction": body.instruction,
             "role": body.role or None,
             "environment": body.environment or None},
        )

        tool_name_to_id: Dict[str, str] = {}
        tools_for_card: List[Dict[str, Any]] = []
        for tool in (body.tools or []):
            tool_id = str(uuid.uuid4())
            tool_name = tool.get("name", "")
            tool_name_key = str(tool_name).strip().lower()
            if tool_name_key:
                tool_name_to_id[tool_name_key] = tool_id
            tools_for_card.append({**tool, "identifier": tool_id})
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.tools
                        (tenant_id, tool_id, tool_name, tool_description,
                         created_ts, updated_ts)
                    VALUES
                        (:tid, :tool_id, :tname, :tdesc,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (tool_id) DO UPDATE SET
                        tool_name        = EXCLUDED.tool_name,
                        tool_description = EXCLUDED.tool_description,
                        updated_ts       = EXCLUDED.updated_ts
                """),
                {"tid": tenant_id, "tool_id": tool_id,
                 "tname": tool_name, "tdesc": tool.get("description", "")},
            )
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_tools
                        (tenant_id, agent_internal_id, tool_id, agent_id,
                         tool_name, created_ts, updated_ts)
                    VALUES
                        (:tid, :iid, :tool_id, :aid,
                         :tname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (agent_internal_id, tool_id) DO UPDATE SET
                        agent_id   = EXCLUDED.agent_id,
                        tool_name  = EXCLUDED.tool_name,
                        updated_ts = EXCLUDED.updated_ts
                """),
                {"tid": tenant_id, "iid": agent_internal_id, "tool_id": tool_id,
                 "aid": agent_id, "tname": tool_name},
            )

        tables_payload = _normalize_tables_payload(body.tables, body.tools, body.data_source)
        for table in tables_payload:
            tool_name_key = str(table.get("tool_name") or "").strip().lower()
            if tool_name_key and not table.get("tool_id"):
                table["tool_id"] = tool_name_to_id.get(tool_name_key)

            table_id = table.get("table_id") or str(uuid.uuid4())
            table["table_id"] = table_id
            table_name = table.get("name")
            table_tool_id = table.get("tool_id")

            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.tables
                        (tenant_id, table_id, name, created_ts, updated_ts)
                    VALUES
                        (:tid, :table_id, :name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (table_id)
                    DO UPDATE SET
                        name = COALESCE(EXCLUDED.name, {CORE}.tables.name),
                        updated_ts = EXCLUDED.updated_ts
                """),
                {
                    "tid": tenant_id,
                    "table_id": table_id,
                    "name": table_name,
                },
            )

            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_tables
                        (tenant_id, agent_id, agent_name, agent_internal_id,
                         table_id, table_name, created_ts, updated_ts)
                    VALUES
                        (:tid, :aid, :aname, :iid, :table_id, :table_name,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (tenant_id, agent_id, table_id) DO UPDATE SET
                        agent_name = EXCLUDED.agent_name,
                        agent_internal_id = EXCLUDED.agent_internal_id,
                        table_name = COALESCE(EXCLUDED.table_name, {CORE}.agent_tables.table_name),
                        updated_ts = EXCLUDED.updated_ts
                """),
                {"tid": tenant_id, "aid": agent_id, "aname": body.agent_name,
                 "iid": agent_internal_id, "table_id": table_id, "table_name": table_name},
            )

            if table_tool_id:
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.agent_data_sources (
                            tenant_id, agent_internal_id, agent_id,
                            created_ts, updated_ts,
                            source_object_id, source_object_name, source_object_type,
                            target_object_id, target_object_name, target_object_type
                        )
                        VALUES (
                            :tid, :iid, :aid,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                            :tool_id, :tool_name, 'Tool',
                            :table_id, :table_name, 'Table'
                        )
                        ON CONFLICT (agent_internal_id, source_object_id, target_object_id)
                        DO UPDATE SET
                            updated_ts = EXCLUDED.updated_ts,
                            source_object_name = EXCLUDED.source_object_name,
                            target_object_name = EXCLUDED.target_object_name
                    """),
                    {
                        "tid": tenant_id,
                        "iid": agent_internal_id,
                        "aid": agent_id,
                        "tool_id": table_tool_id,
                        "tool_name": table.get("tool_name"),
                        "table_id": table_id,
                        "table_name": table_name,
                    },
                )
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.tool_tables
                            (tenant_id, tool_id, tool_name, table_id, table_name,
                             created_ts, updated_ts)
                        VALUES
                            (:tid, :tool_id, :tool_name, :table_id, :table_name,
                             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (tenant_id, tool_id, table_id) DO UPDATE SET
                            tool_name = COALESCE(EXCLUDED.tool_name, {CORE}.tool_tables.tool_name),
                            table_name = COALESCE(EXCLUDED.table_name, {CORE}.tool_tables.table_name),
                            updated_ts = EXCLUDED.updated_ts
                    """),
                    {
                        "tid": tenant_id,
                        "tool_id": table_tool_id,
                        "tool_name": table.get("tool_name"),
                        "table_id": table_id,
                        "table_name": table_name,
                    },
                )
            else:
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.agent_data_sources (
                            tenant_id, agent_internal_id, agent_id,
                            created_ts, updated_ts,
                            source_object_id, source_object_name, source_object_type,
                            target_object_id, target_object_name, target_object_type
                        )
                        VALUES (
                            :tid, :iid, :aid,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                            :aid, :agent_name, 'Agent',
                            :table_id, :table_name, 'Table'
                        )
                    """),
                    {
                        "tid": tenant_id,
                        "iid": agent_internal_id,
                        "aid": agent_id,
                        "agent_name": body.agent_name,
                        "table_id": table_id,
                        "table_name": table_name,
                    },
                )

            for column_name in table.get("columns") or []:
                column_id = str(uuid.uuid5(uuid.NAMESPACE_OID, f"{table_id}:{column_name}"))
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.columns (column_id, tenant_id, name, created_ts, updated_ts)
                        VALUES (:col_id, :tid, :col_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (column_id)
                        DO UPDATE SET
                            tenant_id = EXCLUDED.tenant_id,
                            updated_ts = EXCLUDED.updated_ts
                    """),
                    {"col_id": column_id, "tid": tenant_id, "col_name": column_name},
                )
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.table_columns
                            (tenant_id, table_id, table_name, column_name, column_id, created_ts, updated_ts)
                        VALUES
                            (:tid, :table_id, :table_name, :column_name, :col_id,
                             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (tenant_id, table_id, column_name) DO UPDATE SET
                            table_name = COALESCE(EXCLUDED.table_name, {CORE}.table_columns.table_name),
                            column_id = COALESCE(EXCLUDED.column_id, {CORE}.table_columns.column_id),
                            updated_ts = EXCLUDED.updated_ts
                    """),
                    {"tid": tenant_id, "table_id": table_id,
                     "table_name": table_name, "column_name": column_name, "col_id": column_id},
                )
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.agent_data_sources (
                            tenant_id, agent_internal_id, agent_id,
                            created_ts, updated_ts,
                            source_object_id, source_object_name, source_object_type,
                            target_object_id, target_object_name, target_object_type
                        )
                        VALUES (
                            :tid, :iid, :aid,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                            :table_id, :table_name, 'Table',
                            :col_id, :column_name, 'Column'
                        )
                        ON CONFLICT (agent_internal_id, source_object_id, target_object_id)
                        DO UPDATE SET
                            updated_ts = EXCLUDED.updated_ts,
                            source_object_name = EXCLUDED.source_object_name,
                            target_object_name = EXCLUDED.target_object_name
                    """),
                    {
                        "tid": tenant_id,
                        "iid": agent_internal_id,
                        "aid": agent_id,
                        "table_id": table_id,
                        "table_name": table_name,
                        "col_id": column_id,
                        "column_name": column_name,
                    },
                )

        if body.knowledge_source:
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_knowledge_sources
                        (tenant_id, agent_internal_id, agent_id, name, description,
                         created_ts, updated_ts)
                    VALUES
                        (:tid, :iid, :aid, :name, :desc,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {"tid": tenant_id, "iid": agent_internal_id, "aid": agent_id,
                 "name": body.knowledge_source.get("name", ""),
                 "desc": body.knowledge_source.get("description", "")},
            )

        for skill in _normalize_skill_entries(body.skills):
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.skills
                        (tenant_id, skill_id, name, description,
                         tags, input_modes, output_modes,
                         created_ts, updated_ts)
                    SELECT
                        :tid, :sid, :sname, :sdesc,
                        :tags, :imodes, :omodes,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM {CORE}.skills
                        WHERE COALESCE(tenant_id, '') = COALESCE(:tid, '')
                          AND skill_id = :sid
                    )
                """),
                {"tid": tenant_id, "sid": skill["skill_id"], "sname": skill["skill_name"],
                 "sdesc": skill["description"], "tags": skill["tags"],
                 "imodes": skill["input_modes"], "omodes": skill["output_modes"]},
            )
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_skills
                        (tenant_id, skill_id, skill_name, agent_id, agent_name,
                         agent_internal_id, created_ts, updated_ts)
                    VALUES
                        (:tid, :sid, :sname, :aid, :aname,
                         :iid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {"tid": tenant_id, "sid": skill["skill_id"], "sname": skill["skill_name"],
                 "aid": agent_id, "aname": body.agent_name, "iid": agent_internal_id},
            )

        # Insert a placeholder row into curated.agent_360 immediately so the
        # agent appears in the catalog straight away. Risk data is filled in
        # later when the Temporal workflow completes.
        await db.execute(
            text(f"""
                INSERT INTO {CURATED}.agent_360 (
                    tenant_id, agent_id, agent_internal_id, agent_name, agent_description,
                    snapshot_ts,
                    tool_count, data_source_count, business_application_count,
                    business_process_count, ai_model_count,
                    contains_pii, contains_phi, contains_pci,
                    company_id, company_name
                ) VALUES (
                    :tid, :aid, :iid, :name, :desc,
                    CURRENT_TIMESTAMP,
                    0, 0, 0, 0, 0,
                    false, false, false,
                    :cid, :cname
                )
                ON CONFLICT (agent_internal_id) DO NOTHING
            """),
            {"tid": tenant_id, "aid": agent_id, "iid": agent_internal_id,
             "name": body.agent_name, "desc": body.description, "cid": cid, "cname": cname},
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    _write_agent_card(
        agent_id=agent_id,
        agent_internal_id=agent_internal_id,
        agent_name=body.agent_name,
        description=body.description,
        instruction=body.instruction,
        tools=tools_for_card,
        knowledge_source=body.knowledge_source,
        tables=tables_payload,
        skills=body.skills,
    )

    background_tasks.add_task(
        _fire_risk,
        _risk_payload(agent_internal_id, agent_id, body.agent_name,
                      body.description, body.instruction, tenant_id),
    )

    return {"agent_id": agent_id, "agent_name": body.agent_name,
            "message": "Agent created successfully and risk assessment triggered."}

@router.post("/suggest-description", response_model=SuggestAgentDescriptionResponse, summary="Suggest Agent Description")
async def suggest_agent_description(body: SuggestAgentDescriptionRequest):
    agent_name = body.agent_name.strip()
    if not agent_name:
        raise HTTPException(status_code=400, detail="agent_name is required")

    provider, api_key = _resolve_agent_llm()
    user_prompt = f"""Generate a concise description for this AI agent:

Agent name: {agent_name}

Return ONLY the JSON object with the "description" field."""

    if provider == "openai":
        data = await _call_openai(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_AGENT_DESCRIPTION_SYSTEM,
            300,
        )
    else:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_AGENT_DESCRIPTION_SYSTEM,
            tools=None,
            max_tokens=300,
        )

    raw = _collect_text(data).strip()
    try:
        parsed = json.loads(_extract_json(raw))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return SuggestAgentDescriptionResponse(
        description=str(parsed.get("description", "")).strip(),
    )


# ---------------------------------------------------------------------------
# GET /{agent_id}  — agent card
# ---------------------------------------------------------------------------

@router.get("/{agent_id}", summary="Get Agent Card")
async def get_agent_card(agent_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _require_tenant(request)
    try:
        result = await db.execute(
            text(f"""
                SELECT
                    a.agent_id, a.agent_internal_id, a.agent_name, a.agent_description,
                    a.source_system, a.created_ts, a.updated_ts, a.tenant_id,
                    i.instruction, i.role, i.environment, i.governance_status,
                    r.risk_classification, r.blended_risk_score, r.pii_flag,
                    r.phi_flag, r.pci_flag
                FROM {CORE}.agents a
                LEFT JOIN LATERAL (
                    SELECT instruction, role, environment, governance_status
                    FROM {CORE}.agent_identifications
                    WHERE agent_id = a.agent_id
                      AND COALESCE(is_current, true) = true
                    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
                    LIMIT 1
                ) i ON true
                LEFT JOIN LATERAL (
                    SELECT blended_risk_class AS risk_classification, blended_risk_score, pii_flag, phi_flag, pci_flag
                    FROM {CORE}.agent_risk_assessments
                    WHERE agent_internal_id = a.agent_internal_id
                      AND COALESCE(is_current, true) = true
                    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
                    LIMIT 1
                ) r ON true
                WHERE a.agent_id = :aid
                  AND a.tenant_id = :tid
                  AND a.is_current = true
                LIMIT 1
            """),
            {"aid": agent_id, "tid": tenant_id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        data = dict(row)

        skill_result = await db.execute(
            text(f"""
                SELECT
                    rel.skill_id AS identifier,
                    COALESCE(s.name, rel.skill_name, rel.skill_id) AS name,
                    s.description,
                    COALESCE(s.tags, ARRAY[]::text[]) AS tags,
                    COALESCE(s.input_modes, ARRAY[]::text[]) AS "inputModes",
                    COALESCE(s.output_modes, ARRAY[]::text[]) AS "outputModes"
                FROM {CORE}.agent_skills rel
                LEFT JOIN {CORE}.skills s
                  ON LOWER(TRIM(s.skill_id)) = LOWER(TRIM(rel.skill_id))
                 AND COALESCE(s.tenant_id, '') = COALESCE(rel.tenant_id, '')
                WHERE rel.agent_id = :aid
                  AND rel.tenant_id = :tid
                  AND rel.skill_id IS NOT NULL
                  AND rel.skill_id <> ''
                ORDER BY LOWER(COALESCE(s.name, rel.skill_name, rel.skill_id))
            """),
            {"aid": agent_id, "tid": tenant_id},
        )
        data["skills"] = [dict(skill) for skill in skill_result.mappings().all()]
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{agent_id}/risk-assessment  — trigger risk assessment
# ---------------------------------------------------------------------------

@router.post("/{agent_id}/risk-assessment", summary="Trigger Risk Assessment")
async def trigger_risk_assessment(
    agent_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(request)
    try:
        result = await db.execute(
            text(f"""
                SELECT a.agent_internal_id, a.agent_id, a.agent_name, a.agent_description,
                       a.source_system, i.instruction
                FROM {CORE}.agents a
                LEFT JOIN LATERAL (
                    SELECT instruction
                    FROM {CORE}.agent_identifications
                    WHERE agent_id = a.agent_id
                      AND COALESCE(is_current, true) = true
                    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
                    LIMIT 1
                ) i ON true
                WHERE a.agent_id = :aid
                  AND a.tenant_id = :tid
                  AND a.is_current = true
                LIMIT 1
            """),
            {"aid": agent_id, "tid": tenant_id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    background_tasks.add_task(
        _fire_risk,
        _risk_payload(
            str(row["agent_internal_id"]), str(row["agent_id"]),
            str(row["agent_name"]), str(row["agent_description"] or ""),
            str(row["instruction"] or ""), tenant_id,
        ),
    )
    return {"message": "Risk assessment triggered.", "agent_id": agent_id,
            "agent_internal_id": str(row["agent_internal_id"])}


# ---------------------------------------------------------------------------
# PUT /{agent_id}  — update agent
# ---------------------------------------------------------------------------

@router.put("/{agent_id}", summary="Update Agent")
async def update_agent(agent_id: str, body: AgentUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _require_tenant(request)
    try:
        exists = await db.execute(
            text(f"""
                SELECT agent_internal_id, agent_name
                FROM {CORE}.agents
                WHERE agent_id = :aid AND tenant_id = :tid
                LIMIT 1
            """),
            {"aid": agent_id, "tid": tenant_id},
        )
        agent_row = exists.mappings().first()
        if not agent_row:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

        agent_sets = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"aid": agent_id, "tid": tenant_id}
        effective_agent_name = str(agent_row["agent_name"] or "")

        if body.agent_name and body.agent_name.strip():
            agent_sets.append("agent_name = :name")
            params["name"] = body.agent_name.strip()
            effective_agent_name = body.agent_name.strip()
        if body.description and body.description.strip():
            agent_sets.append("agent_description = :desc")
            params["desc"] = body.description.strip()

        if len(agent_sets) > 1:
            await db.execute(
                text(f"UPDATE {CORE}.agents SET {', '.join(agent_sets)} WHERE agent_id = :aid AND tenant_id = :tid"),
                params,
            )

        if body.instruction is not None and body.instruction.strip():
            await db.execute(
                text(f"""
                    UPDATE {CORE}.agent_identifications
                    SET instruction = :instr, updated_ts = CURRENT_TIMESTAMP
                    WHERE agent_id = :aid
                      AND tenant_id = :tid
                      AND COALESCE(is_current, true) = true
                """),
                {"instr": body.instruction.strip(), "aid": agent_id, "tid": tenant_id},
            )

        # Keep curated snapshot in sync so catalog refresh reflects changes immediately
        curated_sets: List[str] = []
        curated_params: Dict[str, Any] = {"aid": agent_id, "tid": tenant_id}
        if body.agent_name and body.agent_name.strip():
            curated_sets.append("agent_name = :c_name")
            curated_params["c_name"] = body.agent_name.strip()
        if body.description and body.description.strip():
            curated_sets.append("agent_description = :c_desc")
            curated_params["c_desc"] = body.description.strip()
        if curated_sets:
            await db.execute(
                text(f"UPDATE {CURATED}.agent_360 SET {', '.join(curated_sets)} WHERE agent_id = :aid AND tenant_id = :tid"),
                curated_params,
            )

        if body.skills is not None:
            existing_skill_result = await db.execute(
                text(f"""
                    SELECT rel.skill_id, rel.skill_name, s.name, s.description,
                           s.tags, s.input_modes, s.output_modes
                    FROM {CORE}.agent_skills rel
                    LEFT JOIN {CORE}.skills s
                      ON LOWER(TRIM(s.skill_id)) = LOWER(TRIM(rel.skill_id))
                     AND COALESCE(s.tenant_id, '') = COALESCE(rel.tenant_id, '')
                    WHERE rel.agent_id = :aid
                      AND rel.tenant_id = :tid
                      AND rel.skill_id IS NOT NULL
                      AND rel.skill_id <> ''
                """),
                {"aid": agent_id, "tid": tenant_id},
            )
            existing_skills = [dict(row) for row in existing_skill_result.mappings().all()]
            skill_entries = _normalize_skill_entries(body.skills, existing_skills)
            for skill in skill_entries:
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.skills
                            (tenant_id, skill_id, name, description,
                             tags, input_modes, output_modes,
                             created_ts, updated_ts)
                        VALUES
                            (:tid, :sid, :sname, :sdesc,
                             :tags, :imodes, :omodes,
                             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (tenant_id, skill_id) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            tags = EXCLUDED.tags,
                            input_modes = EXCLUDED.input_modes,
                            output_modes = EXCLUDED.output_modes,
                            updated_ts = EXCLUDED.updated_ts
                    """),
                    {"tid": tenant_id, "sid": skill["skill_id"], "sname": skill["skill_name"],
                     "sdesc": skill["description"], "tags": skill["tags"],
                     "imodes": skill["input_modes"], "omodes": skill["output_modes"]},
                )
                await db.execute(
                    text(f"""
                        INSERT INTO {CORE}.agent_skills
                            (tenant_id, skill_id, skill_name, agent_id, agent_name,
                             agent_internal_id, created_ts, updated_ts)
                        VALUES
                            (:tid, :sid, :sname, :aid, :aname,
                             :iid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (tenant_id, skill_id, agent_id) DO UPDATE SET
                            skill_name = EXCLUDED.skill_name,
                            agent_name = EXCLUDED.agent_name,
                            agent_internal_id = EXCLUDED.agent_internal_id,
                            updated_ts = EXCLUDED.updated_ts
                    """),
                    {"tid": tenant_id, "sid": skill["skill_id"], "sname": skill["skill_name"],
                     "aid": agent_id, "aname": effective_agent_name,
                     "iid": str(agent_row["agent_internal_id"])},
                )

        await db.commit()
        return {"message": "Agent updated successfully.", "agent_id": agent_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{agent_id}  — cascade delete
# ---------------------------------------------------------------------------

@router.delete("/{agent_id}", summary="Delete Agent")
async def delete_agent(agent_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _require_tenant(request)
    try:
        row = await db.execute(
            text(f"SELECT agent_internal_id FROM {CORE}.agents WHERE agent_id = :aid AND tenant_id = :tid LIMIT 1"),
            {"aid": agent_id, "tid": tenant_id},
        )
        mapping = row.mappings().first()
        if not mapping:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        internal_id = str(mapping["agent_internal_id"])

        await db.execute(
            text(f"""
                WITH deleted_rel AS (
                    DELETE FROM {CORE}.agent_ai_use_cases
                    WHERE agent_id = :aid
                    RETURNING ai_use_case_id
                ),
                affected AS (
                    SELECT DISTINCT ai_use_case_id
                    FROM deleted_rel
                    WHERE ai_use_case_id IS NOT NULL AND ai_use_case_id <> ''
                ),
                counts AS (
                    SELECT
                        a.ai_use_case_id,
                        COUNT(DISTINCT rel.agent_id) AS associated_count
                    FROM affected a
                    LEFT JOIN {CORE}.agent_ai_use_cases rel
                      ON rel.ai_use_case_id = a.ai_use_case_id
                     AND rel.agent_id IS NOT NULL
                     AND rel.agent_id <> ''
                    GROUP BY a.ai_use_case_id
                )
                UPDATE {CORE}.ai_use_cases uc
                SET
                    no_of_associated_agents = c.associated_count,
                    updated_ts = CURRENT_TIMESTAMP
                FROM counts c
                WHERE uc.ai_use_case_id = c.ai_use_case_id
            """),
            {"aid": agent_id, "tid": tenant_id},
        )

        for table in ("agent_tools", "agent_knowledge_sources", "agent_data_sources", "agent_identifications"):
            await db.execute(
                text(f"DELETE FROM {CORE}.{table} WHERE agent_id = :aid AND tenant_id = :tid"),
                {"aid": agent_id, "tid": tenant_id},
            )

        await db.execute(
            text(f"DELETE FROM {CORE}.agent_risk_assessments WHERE agent_internal_id = :iid AND tenant_id = :tid"),
            {"iid": internal_id, "tid": tenant_id},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.agents WHERE agent_id = :aid AND tenant_id = :tid"),
            {"aid": agent_id, "tid": tenant_id},
        )

        for schema_table in (f"{CURATED}.agent_360", f"{RISK}.agent_risk_assessment"):
            try:
                sp = await db.begin_nested()
                await db.execute(
                    text(f"DELETE FROM {schema_table} WHERE agent_internal_id = :iid AND tenant_id = :tid"),
                    {"iid": internal_id, "tid": tenant_id},
                )
                await sp.commit()
            except Exception:
                await sp.rollback()

        await db.commit()
        return {"message": "Agent deleted successfully.", "agent_id": agent_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

@router.get("/{agent_id}/attachments", summary="List Agent Attachments")
async def list_agent_attachments(agent_id: str, db: AsyncSession = Depends(get_db)):
    await _ensure_agent_attachments_table(db)

    rows = await db.execute(
        text(
            """
            SELECT id, agent_id, filename, mime_type, file_size_bytes, created_at, updated_at
            FROM public.agent_attachment
            WHERE agent_id = :agent_id
            ORDER BY created_at DESC
            """
        ),
        {"agent_id": agent_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{agent_id}/attachments", summary="Upload Agent Attachment", status_code=201)
async def create_agent_attachment(
    agent_id: str,
    body: AgentAttachmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_agent_attachments_table(db)

    filename = (body.filename or "").strip()
    mime_type = (body.mime_type or "").strip() or "application/octet-stream"
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")

    try:
        file_data = base64.b64decode(body.content_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid content_base64 payload") from exc

    if not file_data:
        raise HTTPException(status_code=400, detail="Attachment file is empty")
    if len(file_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Attachment exceeds 10 MB limit")

    row = await db.execute(
        text(
            """
            INSERT INTO public.agent_attachment
                (agent_id, filename, mime_type, file_size_bytes, file_data)
            VALUES
                (:agent_id, :filename, :mime_type, :file_size_bytes, :file_data)
            RETURNING id, agent_id, filename, mime_type, file_size_bytes, created_at, updated_at
            """
        ),
        {
            "agent_id": agent_id,
            "filename": filename,
            "mime_type": mime_type,
            "file_size_bytes": len(file_data),
            "file_data": file_data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get("/{agent_id}/attachments/{attachment_id}/download", summary="Download Agent Attachment")
async def download_agent_attachment(
    agent_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_agent_attachments_table(db)

    row = await db.execute(
        text(
            """
            SELECT filename, mime_type, file_data
            FROM public.agent_attachment
            WHERE id = :attachment_id
              AND agent_id = :agent_id
            LIMIT 1
            """
        ),
        {"attachment_id": attachment_id, "agent_id": agent_id},
    )
    attachment = row.mappings().first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    filename = attachment["filename"] or "attachment.bin"
    mime_type = attachment["mime_type"] or "application/octet-stream"
    return Response(
        content=bytes(attachment["file_data"]),
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{agent_id}/attachments/{attachment_id}", summary="Delete Agent Attachment")
async def delete_agent_attachment(
    agent_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_agent_attachments_table(db)

    result = await db.execute(
        text(
            """
            DELETE FROM public.agent_attachment
            WHERE id = :attachment_id
              AND agent_id = :agent_id
            """
        ),
        {"attachment_id": attachment_id, "agent_id": agent_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"status": "deleted", "attachment_id": attachment_id}
