from __future__ import annotations

import base64
import json
from uuid import uuid4
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()
_TABLE_COLUMNS_CACHE: dict[tuple[str, str], set[str]] = {}
_TABLE_EXISTS_CACHE: dict[tuple[str, str], bool] = {}
_AGENT_ATTACHMENTS_READY = False
_APPLICATION_ATTACHMENTS_READY = False
_PROCESS_ATTACHMENTS_READY = False

_APPLICATION_EDITABLE_COLUMNS: set[str] = {
    "application_name",
    "emergency_tier",
    "business_owner",
    "application_portfolio_manager",
    "vendor_name",
    "business_criticality",
    "it_application_owner",
    "application_description",
    "embedded_ai",
    "opt_out_option",
    "privacy_policy_url",
    "data_excluded_from_ai_training",
    "vendor_description",
    "current_installed_version",
    "is_current_version_supported",
    "latest_released_version",
    "latest_release_date",
    "latest_release_documentation_link",
}

_APPLICATION_READONLY_DEFAULTS: dict[str, Any] = {
    "agent_risk_exposure": 0.0,
    "num_of_associated_agents": 0,
    "blended_risk_score": 0.0,
    "inherent_risk_classification_score": 0.0,
    "residual_risk_classification_score": 0.0,
}

_APPLICATION_ALIAS_MAP: dict[str, str] = {
    "are": "agent_risk_exposure",
    "associated_agents": "num_of_associated_agents",
    "embededd_ai": "embedded_ai",
    "data_specifically_excluded_from_ai_training": "data_excluded_from_ai_training",
    "is_current_installed_version_supported": "is_current_version_supported",
}

_PROCESS_EDITABLE_COLUMNS: set[str] = {
    "process_number",
    "process_name",
    "process_description",
    "parent_process_id",
    "stakeholders",
    "owner",
    "operators",
    "business_criticality",
    "reputational_impact",
    "financial_impact",
    "regulatory_impact",
    "sla",
    "process_health_state",
}

_PROCESS_READONLY_DEFAULTS: dict[str, Any] = {
    "num_of_associated_agents": 0,
    "agent_risk_exposure": 0.0,
    "blended_risk_score": 0.0,
    "residual_risk_classification_score": 0.0,
    "inherent_risk_classification_score": 0.0,
}

_PROCESS_ALIAS_MAP: dict[str, str] = {
    "number": "process_number",
    "name": "process_name",
    "associated_agents": "num_of_associated_agents",
    "are": "agent_risk_exposure",
}

_INTEGRATION_EDITABLE_COLUMNS: set[str] = {
    "integration_name",
    "integration_description",
    "capabilities",
    "protocol",
    "endpoint_url",
    "authentication_method",
    "owner",
    "documentation_url",
    "data_sensitivity",
    "rate_limit",
    "availability_status",
    "sla",
    "version",
    "parent_application_id",
}

_INTEGRATION_READONLY_DEFAULTS: dict[str, Any] = {}

_PROCESS_LABEL_TO_VALUE_MAP: dict[str, dict[str, str]] = {
    "business_criticality": {
        "Tier 1 (Systemic)": "1.0",
        "Tier 2 (Core)": "0.7",
        "Tier 3 (Operational)": "0.4",
        "Tier 4 (Experimental)": "0.1",
    },
    "reputational_impact": {
        "Toxic": "1",
        "Adverse": "0.7",
        "Private": "0.4",
        "Contained": "0.1",
    },
    "financial_impact": {
        "Systemic": "1",
        "Material": "0.7",
        "Absorbable": "0.4",
        "Immaterial": "0.1",
    },
    "regulatory_impact": {
        "Restricted": "1",
        "Statutory": "0.7",
        "Governed": "0.4",
        "Unregulated": "0.1",
    },
}


class Application(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_name: Optional[str] = None
    emergency_tier: Optional[str] = None
    business_owner: Optional[str] = None
    application_portfolio_manager: Optional[str] = None
    vendor_name: Optional[str] = None
    business_criticality: Optional[str] = None
    it_application_owner: Optional[str] = None
    application_description: Optional[str] = None
    embedded_ai: Optional[str] = None
    opt_out_option: Optional[str] = None
    privacy_policy_url: Optional[str] = None
    data_excluded_from_ai_training: Optional[str] = None
    vendor_description: Optional[str] = None
    current_installed_version: Optional[str] = None
    is_current_version_supported: Optional[str] = None
    latest_released_version: Optional[str] = None
    latest_release_date: Optional[str] = None
    latest_release_documentation_link: Optional[str] = None
    # Backward-compatible aliases accepted by canonical mapping:
    are: Optional[str] = None
    associated_agents: Optional[str] = None
    embededd_ai: Optional[str] = None
    data_specifically_excluded_from_ai_training: Optional[str] = None
    is_current_installed_version_supported: Optional[str] = None


class ApplicationCreate(Application):
    pass


class ApplicationUpdate(Application):
    pass


class Process(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_number: Optional[str] = None
    process_name: Optional[str] = None
    process_description: Optional[str] = None
    parent_process_id: Optional[str] = None
    stakeholders: Optional[str] = None
    owner: Optional[str] = None
    operators: Optional[str] = None
    business_criticality: Optional[str] = None
    reputational_impact: Optional[str] = None
    financial_impact: Optional[str] = None
    regulatory_impact: Optional[str] = None
    sla: Optional[str] = None
    process_health_state: Optional[str] = None
    # Backward-compatible aliases accepted by canonical mapping:
    number: Optional[str] = None
    name: Optional[str] = None
    associated_agents: Optional[str] = None
    are: Optional[str] = None


class ProcessCreate(Process):
    pass


class ProcessUpdate(Process):
    pass

class Integration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    integration_name: Optional[str] = None
    integration_description: Optional[str] = None
    capabilities: Optional[str] = None
    protocol: Optional[str] = None
    endpoint_url: Optional[str] = None
    authentication_method: Optional[str] = None
    owner: Optional[str] = None
    documentation_url: Optional[str] = None
    data_sensitivity: Optional[str] = None
    rate_limit: Optional[str] = None
    availability_status: Optional[str] = None
    sla: Optional[str] = None
    version: Optional[str] = None
    parent_application_id: Optional[str] = None


class IntegrationCreate(Integration):
    pass

class IntegrationUpdate(Integration):
    pass


class AgentAttachmentCreate(BaseModel):
    filename: str
    mime_type: str
    content_base64: str


class EntityAttachmentCreate(BaseModel):
    filename: str
    mime_type: str
    content_base64: str

class SuggestApplicationDescriptionRequest(BaseModel):
    application_name: str


class SuggestApplicationDescriptionResponse(BaseModel):
    description: str


class SuggestProcessDescriptionRequest(BaseModel):
    process_name: str


class SuggestProcessDescriptionResponse(BaseModel):
    description: str


SUGGEST_APPLICATION_DESCRIPTION_SYSTEM = """You are helping a user create a business application record in Tavro.

Given only an application name, generate a short plain-text application description.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Be specific and practical, but do not invent company-specific facts, versions, vendors, or integrations unless clearly implied by the name.
- Focus on the application's likely business purpose and who uses it.
- Do not assume a specific technical approach such as machine learning, LLMs, OCR, NLP, real-time processing, APIs, or automation patterns unless that is explicit in the name.
- If the name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence application description"
}"""


SUGGEST_PROCESS_DESCRIPTION_SYSTEM = """You are helping a user create a business process record in Tavro.

Given only a process name, generate a short plain-text process description.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Be specific and practical, but do not invent company-specific facts, systems, or implementation details.
- Focus on the process's likely workflow, business purpose, and outcome.
- Do not assume a specific technical approach such as machine learning, LLMs, OCR, NLP, real-time processing, APIs, or automation patterns unless that is explicit in the name.
- If the name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence process description"
}"""


_INTEGRATIONS_READY = False


async def _sync_integration_to_dim_node(db: AsyncSession, company_id: str, integration: dict) -> None:
    """Sync a saved integration into twin.dim_node so Spark can use it as context."""
    try:
        name = (integration.get("integration_name") or "").strip()
        if not name:
            return
        desc = integration.get("integration_description") or ""
        caps = integration.get("capabilities") or ""
        summary = (f"{desc}\nCapabilities: {caps}".strip() if caps else desc)[:800] or None

        # Find or create the dim_type for "integration" category for this company
        result = await db.execute(
            text("""
                SELECT id FROM twin.dim_type
                WHERE company_id = :company_id AND category = 'integration'
                LIMIT 1
            """),
            {"company_id": company_id},
        )
        row = result.mappings().first()
        if not row:
            await db.execute(
                text("""
                    INSERT INTO twin.dim_type (company_id, category, label)
                    VALUES (:company_id, 'integration', 'Integrations')
                    ON CONFLICT DO NOTHING
                """),
                {"company_id": company_id},
            )
            await db.commit()
            result = await db.execute(
                text("""
                    SELECT id FROM twin.dim_type
                    WHERE company_id = :company_id AND category = 'integration'
                    LIMIT 1
                """),
                {"company_id": company_id},
            )
            row = result.mappings().first()
        if not row:
            return

        dim_type_id = row["id"]
        await db.execute(
            text("""
                INSERT INTO twin.dim_node (company_id, dim_type_id, label, summary)
                VALUES (:company_id, :dim_type_id, :label, :summary)
                ON CONFLICT (company_id, dim_type_id, label)
                DO UPDATE SET summary = EXCLUDED.summary, updated_at = NOW()
            """),
            {"company_id": company_id, "dim_type_id": dim_type_id, "label": name, "summary": summary},
        )
        await db.commit()
    except Exception:
        pass  # Non-fatal — don't break the integration save


async def _ensure_integrations_table(db: AsyncSession) -> None:
    global _INTEGRATIONS_READY
    if _INTEGRATIONS_READY:
        return

    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS core.business_integrations (
                integration_id TEXT PRIMARY KEY,
                tenant_id TEXT,
                integration_name TEXT,
                integration_description TEXT,
                capabilities TEXT,
                protocol TEXT,
                endpoint_url TEXT,
                authentication_method TEXT,
                owner TEXT,
                documentation_url TEXT,
                data_sensitivity TEXT,
                rate_limit TEXT,
                availability_status TEXT,
                sla TEXT,
                version TEXT,
                parent_application_id TEXT,
                created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_ts TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
    )
    await db.execute(
        text("ALTER TABLE core.business_integrations ADD COLUMN IF NOT EXISTS capabilities TEXT")
    )
    await db.commit()
    _INTEGRATIONS_READY = True


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

async def _suggest_single_description(name: str, system_prompt: str, label: str) -> str:
    provider, api_key = _resolve_agent_llm()
    user_prompt = f"""Generate a concise description for this {label}:

Name: {name}

Return ONLY the JSON object with the "description" field."""

    if provider == "openai":
        data = await _call_openai(
            api_key,
            [{"role": "user", "content": user_prompt}],
            system_prompt,
            300,
        )
    else:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user_prompt}],
            system_prompt,
            tools=None,
            max_tokens=300,
        )

    raw = _collect_text(data).strip()
    parsed = json.loads(_extract_json(raw))
    return str(parsed.get("description", "")).strip()


async def _ensure_application_attachments_table(db: AsyncSession) -> None:
    global _APPLICATION_ATTACHMENTS_READY
    if _APPLICATION_ATTACHMENTS_READY:
        return

    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.application_attachment (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                application_id TEXT NOT NULL,
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
            CREATE INDEX IF NOT EXISTS application_attachment_application_idx
            ON public.application_attachment (application_id, created_at DESC)
            """
        )
    )
    await db.commit()
    _APPLICATION_ATTACHMENTS_READY = True


async def _ensure_process_attachments_table(db: AsyncSession) -> None:
    global _PROCESS_ATTACHMENTS_READY
    if _PROCESS_ATTACHMENTS_READY:
        return

    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.process_attachment (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                process_id TEXT NOT NULL,
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
            CREATE INDEX IF NOT EXISTS process_attachment_process_idx
            ON public.process_attachment (process_id, created_at DESC)
            """
        )
    )
    await db.commit()
    _PROCESS_ATTACHMENTS_READY = True


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _normalize_integration_row(row: dict[str, Any]) -> dict[str, Any]:
    row["related_agents"] = _json_list(row.get("related_agents"))
    row["related_agent_count"] = int(row.get("related_agent_count") or 0)
    return row


def _normalize_application_row(row: dict[str, Any]) -> dict[str, Any]:
    row["related_agents"] = _json_list(row.get("related_agents"))
    row["related_agent_count"] = int(row.get("related_agent_count") or 0)
    return row


def _normalize_process_row(row: dict[str, Any]) -> dict[str, Any]:
    row["related_agents"] = _json_list(row.get("related_agents"))
    related_processes_raw = _json_list(row.get("related_processes"))
    related_use_cases_raw = _json_list(row.get("related_use_cases"))
    normalized_related_processes: list[dict[str, Any]] = []
    normalized_related_use_cases: list[dict[str, Any]] = []
    seen_process_ids: set[str] = set()
    seen_use_case_ids: set[str] = set()

    for rel in related_processes_raw:
        if not isinstance(rel, dict):
            continue
        process_id = _text_or_none(rel.get("business_process_id"))
        if not process_id or process_id in seen_process_ids:
            continue
        seen_process_ids.add(process_id)
        normalized_related_processes.append(
            {
                "business_process_id": process_id,
                "process_name": _text_or_none(rel.get("process_name")),
                "relationship_type": _text_or_none(rel.get("relationship_type")),
            }
        )

    parent_process_id = _text_or_none(row.get("parent_process_id"))
    if parent_process_id and parent_process_id not in seen_process_ids:
        normalized_related_processes.append(
            {
                "business_process_id": parent_process_id,
                "process_name": _text_or_none(row.get("parent_process_name")),
                "relationship_type": "PARENT",
            }
        )

    row["related_processes"] = normalized_related_processes
    for rel in related_use_cases_raw:
        if not isinstance(rel, dict):
            continue
        use_case_id = _text_or_none(rel.get("identifier") or rel.get("ai_use_case_id"))
        if not use_case_id or use_case_id in seen_use_case_ids:
            continue
        seen_use_case_ids.add(use_case_id)
        normalized_related_use_cases.append(
            {
                "identifier": use_case_id,
                "name": _text_or_none(rel.get("name")),
                "description": _text_or_none(rel.get("description")),
                "owner": _text_or_none(rel.get("owner")),
                "priority": _text_or_none(rel.get("priority")),
                "status": _text_or_none(rel.get("status")),
            }
        )
    row["related_use_cases"] = normalized_related_use_cases
    row["related_agent_count"] = int(row.get("related_agent_count") or 0)
    return row


async def _table_columns(db: AsyncSession, schema_name: str, table_name: str) -> set[str]:
    cache_key = (schema_name, table_name)
    if cache_key in _TABLE_COLUMNS_CACHE:
        return _TABLE_COLUMNS_CACHE[cache_key]

    rows = await db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = :schema_name
              AND table_name = :table_name
            """
        ),
        {"schema_name": schema_name, "table_name": table_name},
    )
    cols = {str(r._mapping["column_name"]) for r in rows}
    _TABLE_COLUMNS_CACHE[cache_key] = cols
    return cols


async def _table_exists(db: AsyncSession, schema_name: str, table_name: str) -> bool:
    cache_key = (schema_name, table_name)
    if cache_key in _TABLE_EXISTS_CACHE:
        return _TABLE_EXISTS_CACHE[cache_key]

    row = await db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
            ) AS exists_flag
            """
        ),
        {"schema_name": schema_name, "table_name": table_name},
    )
    exists = bool(row.mappings().first().get("exists_flag"))
    _TABLE_EXISTS_CACHE[cache_key] = exists
    return exists


def _col_expr(alias: str, cols: set[str], col_name: str) -> str:
    if col_name in cols:
        return f"{alias}.{col_name} AS {col_name}"
    return f"NULL AS {col_name}"


def _text_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return _clean(value)
    return _clean(str(value))


def _canonical_payload(raw_payload: Optional[dict[str, Any]], alias_map: dict[str, str]) -> dict[str, Any]:
    payload = raw_payload or {}
    out: dict[str, Any] = {}
    for key, value in payload.items():
        canonical = alias_map.get(key, key)
        out[canonical] = value
    return out


def _pick_text_columns(
    payload: dict[str, Any],
    *,
    allowed_columns: set[str],
    existing_columns: set[str],
) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    for col in allowed_columns:
        if col not in existing_columns or col not in payload:
            continue
        updates[col] = _text_or_none(payload.get(col))
    return updates


def _normalize_process_dropdown_values(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    for field, label_map in _PROCESS_LABEL_TO_VALUE_MAP.items():
        if field not in normalized:
            continue
        raw_value = _text_or_none(normalized.get(field))
        if raw_value is None:
            normalized[field] = None
            continue
        normalized[field] = label_map.get(raw_value, raw_value)
    return normalized


async def _process_exists(db: AsyncSession, business_process_id: str) -> bool:
    row = await db.execute(
        text(
            """
            SELECT 1
            FROM core.business_processes
            WHERE business_process_id = :business_process_id
            LIMIT 1
            """
        ),
        {"business_process_id": business_process_id},
    )
    return row.first() is not None


async def _resolve_agent(db: AsyncSession, agent_id: str) -> dict[str, Any]:
    agent_cols = await _table_columns(db, "core", "agents")
    if "agent_id" not in agent_cols:
        raise HTTPException(status_code=500, detail="core.agents.agent_id column not found")

    order_parts: list[str] = []
    if "is_current" in agent_cols:
        order_parts.append("CASE WHEN COALESCE(is_current, FALSE) THEN 0 ELSE 1 END")
    if "updated_ts" in agent_cols:
        order_parts.append("updated_ts DESC NULLS LAST")
    if not order_parts:
        order_parts.append("1")

    select_agent_internal_id = (
        "agent_internal_id" if "agent_internal_id" in agent_cols else "NULL AS agent_internal_id"
    )
    select_agent_name = "agent_name" if "agent_name" in agent_cols else "NULL AS agent_name"
    select_tenant_id = "tenant_id" if "tenant_id" in agent_cols else "NULL AS tenant_id"

    row = await db.execute(
        text(
            f"""
            SELECT
                agent_id,
                {select_agent_internal_id},
                {select_agent_name},
                {select_tenant_id}
            FROM core.agents
            WHERE agent_id = :agent_id
            ORDER BY {", ".join(order_parts)}
            LIMIT 1
            """
        ),
        {"agent_id": agent_id},
    )
    agent = row.mappings().first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    if not agent.get("agent_internal_id"):
        raise HTTPException(
            status_code=400,
            detail=f"Agent '{agent_id}' exists but has no agent_internal_id",
        )
    return dict(agent)


async def _refresh_application_rollup(db: AsyncSession, business_application_id: str) -> None:
    await db.execute(
        text(
            """
            UPDATE core.business_applications ba
            SET
                num_of_associated_agents = stats.link_count,
                updated_ts = CURRENT_TIMESTAMP
            FROM (
                SELECT
                    COUNT(*)::int AS link_count
                FROM core.agent_business_applications
                WHERE business_application_id = :business_application_id
            ) AS stats
            WHERE ba.business_application_id = :business_application_id
            """
        ),
        {"business_application_id": business_application_id},
    )


async def _refresh_process_rollup(db: AsyncSession, business_process_id: str) -> None:
    await db.execute(
        text(
            """
            UPDATE core.business_processes bp
            SET
                num_of_associated_agents = stats.link_count,
                updated_ts = CURRENT_TIMESTAMP
            FROM (
                SELECT
                    COUNT(*)::int AS link_count
                FROM core.agent_business_processes
                WHERE business_process_id = :business_process_id
            ) AS stats
            WHERE bp.business_process_id = :business_process_id
            """
        ),
        {"business_process_id": business_process_id},
    )


async def _fetch_integrations(
    db: AsyncSession,
    *,
    integration_id: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    await _ensure_integrations_table(db)

    int_cols = await _table_columns(db, "core", "business_integrations")
    if "integration_id" not in int_cols:
        raise HTTPException(
            status_code=500,
            detail="core.business_integrations.integration_id column not found",
        )

    select_cols = [
        _col_expr("bi", int_cols, "integration_id"),
        _col_expr("bi", int_cols, "tenant_id"),
        _col_expr("bi", int_cols, "integration_name"),
        _col_expr("bi", int_cols, "integration_description"),
        _col_expr("bi", int_cols, "capabilities"),
        _col_expr("bi", int_cols, "protocol"),
        _col_expr("bi", int_cols, "endpoint_url"),
        _col_expr("bi", int_cols, "authentication_method"),
        _col_expr("bi", int_cols, "owner"),
        _col_expr("bi", int_cols, "documentation_url"),
        _col_expr("bi", int_cols, "data_sensitivity"),
        _col_expr("bi", int_cols, "rate_limit"),
        _col_expr("bi", int_cols, "availability_status"),
        _col_expr("bi", int_cols, "sla"),
        _col_expr("bi", int_cols, "version"),
        _col_expr("bi", int_cols, "parent_application_id"),
        "pa.application_name AS parent_application_name",
        _col_expr("bi", int_cols, "created_ts"),
        _col_expr("bi", int_cols, "updated_ts"),
        "NULL::json AS related_agents",
        "0::int AS related_agent_count",
    ]

    where_parts: list[str] = []
    query_params: dict[str, Any] = {}
    if integration_id is not None:
        where_parts.append("bi.integration_id = :integration_id")
        query_params["integration_id"] = integration_id

    search_clean = _clean(search)
    if search_clean:
        search_clauses = ["bi.integration_id ILIKE :search_like"]
        if "integration_name" in int_cols:
            search_clauses.append("COALESCE(bi.integration_name, '') ILIKE :search_like")
        if "integration_description" in int_cols:
            search_clauses.append("COALESCE(bi.integration_description, '') ILIKE :search_like")
        if "owner" in int_cols:
            search_clauses.append("COALESCE(bi.owner, '') ILIKE :search_like")
        if "protocol" in int_cols:
            search_clauses.append("COALESCE(bi.protocol, '') ILIKE :search_like")
        where_parts.append("(" + " OR ".join(search_clauses) + ")")
        query_params["search_like"] = f"%{search_clean}%"

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    order_sql = (
        "LOWER(COALESCE(bi.integration_name, bi.integration_id))"
        if "integration_name" in int_cols
        else "LOWER(bi.integration_id)"
    )

    has_ba = await _table_exists(db, "core", "business_applications")
    ba_join_sql = (
        "LEFT JOIN core.business_applications pa ON pa.business_application_id = bi.parent_application_id"
        if has_ba
        else ""
    )

    rows = await db.execute(
        text(
            f"""
            SELECT
                {", ".join(select_cols)}
            FROM core.business_integrations bi
            {ba_join_sql}
            {where_sql}
            ORDER BY {order_sql}
            """
        ),
        query_params,
    )
    return [_normalize_integration_row(dict(r._mapping)) for r in rows]


async def _fetch_applications(
    db: AsyncSession,
    *,
    application_id: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    app_cols = await _table_columns(db, "core", "business_applications")
    if "business_application_id" not in app_cols:
        raise HTTPException(
            status_code=500,
            detail="core.business_applications.business_application_id column not found",
        )

    select_cols = [
        _col_expr("ba", app_cols, "tenant_id"),
        _col_expr("ba", app_cols, "business_application_id"),
        _col_expr("ba", app_cols, "agent_id"),
        _col_expr("ba", app_cols, "agent_internal_id"),
        _col_expr("ba", app_cols, "application_name"),
        _col_expr("ba", app_cols, "emergency_tier"),
        _col_expr("ba", app_cols, "business_owner"),
        _col_expr("ba", app_cols, "application_portfolio_manager"),
        _col_expr("ba", app_cols, "vendor_name"),
        _col_expr("ba", app_cols, "business_criticality"),
        _col_expr("ba", app_cols, "it_application_owner"),
        _col_expr("ba", app_cols, "application_description"),
        _col_expr("ba", app_cols, "agent_risk_exposure"),
        _col_expr("ba", app_cols, "num_of_associated_agents"),
        _col_expr("ba", app_cols, "inherent_risk_classification"),
        _col_expr("ba", app_cols, "residual_risk_classification"),
        _col_expr("ba", app_cols, "agent_risk_tier"),
        _col_expr("ba", app_cols, "blended_risk_score"),
        _col_expr("ba", app_cols, "inherent_risk_classification_score"),
        _col_expr("ba", app_cols, "residual_risk_classification_score"),
        _col_expr("ba", app_cols, "embedded_ai"),
        _col_expr("ba", app_cols, "opt_out_option"),
        _col_expr("ba", app_cols, "privacy_policy_url"),
        _col_expr("ba", app_cols, "data_excluded_from_ai_training"),
        _col_expr("ba", app_cols, "vendor_description"),
        _col_expr("ba", app_cols, "current_installed_version"),
        _col_expr("ba", app_cols, "is_current_version_supported"),
        _col_expr("ba", app_cols, "latest_released_version"),
        _col_expr("ba", app_cols, "latest_release_date"),
        _col_expr("ba", app_cols, "latest_release_documentation_link"),
        _col_expr("ba", app_cols, "created_ts"),
        _col_expr("ba", app_cols, "updated_ts"),
        "rel.related_agents",
        "COALESCE(rel.related_agent_count, 0) AS related_agent_count",
    ]

    has_aba = await _table_exists(db, "core", "agent_business_applications")
    if has_aba:
        aba_cols = await _table_columns(db, "core", "agent_business_applications")
        aba_agent_id_expr = "aba.agent_id" if "agent_id" in aba_cols else "NULL::text"
        aba_agent_internal_id_expr = (
            "aba.agent_internal_id" if "agent_internal_id" in aba_cols else "NULL::text"
        )
        aba_filter = (
            "aba.business_application_id = ba.business_application_id"
            if "business_application_id" in aba_cols
            else "FALSE"
        )
        rel_join_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'agent_id', refs.agent_id,
                            'agent_internal_id', refs.agent_internal_id,
                            'agent_name', refs.agent_name
                        )
                        ORDER BY LOWER(COALESCE(refs.agent_name, refs.agent_id, refs.agent_internal_id))
                    ) AS related_agents,
                    COUNT(*)::int AS related_agent_count
                FROM (
                    SELECT DISTINCT
                        {aba_agent_id_expr} AS agent_id,
                        {aba_agent_internal_id_expr} AS agent_internal_id,
                        NULL::text AS agent_name
                    FROM core.agent_business_applications aba
                    WHERE {aba_filter}
                ) refs
            ) rel ON TRUE
        """
    else:
        rel_join_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_agents, 0::int AS related_agent_count
            ) rel ON TRUE
        """

    search_clean = _clean(search)
    order_sql = (
        "LOWER(COALESCE(ba.application_name, ba.business_application_id))"
        if "application_name" in app_cols
        else "LOWER(ba.business_application_id)"
    )

    where_parts: list[str] = []
    query_params: dict[str, Any] = {}
    if application_id is not None:
        where_parts.append("ba.business_application_id = :application_id")
        query_params["application_id"] = application_id

    if search_clean:
        search_clauses = ["ba.business_application_id ILIKE :search_like"]
        if "application_name" in app_cols:
            search_clauses.append("COALESCE(ba.application_name, '') ILIKE :search_like")
        if "application_description" in app_cols:
            search_clauses.append("COALESCE(ba.application_description, '') ILIKE :search_like")
        where_parts.append("(" + " OR ".join(search_clauses) + ")")
        query_params["search_like"] = f"%{search_clean}%"

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    rows = await db.execute(
        text(
            f"""
            SELECT
                {", ".join(select_cols)}
            FROM core.business_applications ba
            {rel_join_sql}
            {where_sql}
            ORDER BY {order_sql}
            """
        ),
        query_params,
    )
    return [_normalize_application_row(dict(r._mapping)) for r in rows]


async def _fetch_processes(
    db: AsyncSession,
    *,
    process_id: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    process_cols = await _table_columns(db, "core", "business_processes")
    if "business_process_id" not in process_cols:
        raise HTTPException(
            status_code=500,
            detail="core.business_processes.business_process_id column not found",
        )

    select_cols = [
        _col_expr("bp", process_cols, "tenant_id"),
        _col_expr("bp", process_cols, "business_process_id"),
        _col_expr("bp", process_cols, "agent_id"),
        _col_expr("bp", process_cols, "agent_internal_id"),
        _col_expr("bp", process_cols, "process_number"),
        _col_expr("bp", process_cols, "process_name"),
        _col_expr("bp", process_cols, "process_description"),
        _col_expr("bp", process_cols, "parent_process_id"),
        "parent.process_name AS parent_process_name" if "process_name" in process_cols else "NULL AS parent_process_name",
        _col_expr("bp", process_cols, "owner"),
        _col_expr("bp", process_cols, "stakeholders"),
        _col_expr("bp", process_cols, "operators"),
        _col_expr("bp", process_cols, "business_criticality"),
        _col_expr("bp", process_cols, "reputational_impact"),
        _col_expr("bp", process_cols, "num_of_associated_agents"),
        _col_expr("bp", process_cols, "agent_risk_tier"),
        _col_expr("bp", process_cols, "residual_risk_classification"),
        _col_expr("bp", process_cols, "inherent_risk_classification"),
        _col_expr("bp", process_cols, "financial_impact"),
        _col_expr("bp", process_cols, "regulatory_impact"),
        _col_expr("bp", process_cols, "agent_risk_exposure"),
        _col_expr("bp", process_cols, "blended_risk_score"),
        _col_expr("bp", process_cols, "residual_risk_classification_score"),
        _col_expr("bp", process_cols, "inherent_risk_classification_score"),
        _col_expr("bp", process_cols, "sla"),
        _col_expr("bp", process_cols, "process_health_state"),
        _col_expr("bp", process_cols, "created_ts"),
        _col_expr("bp", process_cols, "updated_ts"),
        "rel.related_agents",
        "COALESCE(rel.related_agent_count, 0) AS related_agent_count",
        "proc_rel.related_processes",
        "uc_rel.related_use_cases",
    ]

    has_abp = await _table_exists(db, "core", "agent_business_processes")
    if has_abp:
        abp_cols = await _table_columns(db, "core", "agent_business_processes")
        abp_agent_id_expr = "abp.agent_id" if "agent_id" in abp_cols else "NULL::text"
        abp_agent_internal_id_expr = (
            "abp.agent_internal_id" if "agent_internal_id" in abp_cols else "NULL::text"
        )
        abp_filter = (
            "abp.business_process_id = bp.business_process_id"
            if "business_process_id" in abp_cols
            else "FALSE"
        )
        rel_join_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'agent_id', refs.agent_id,
                            'agent_internal_id', refs.agent_internal_id,
                            'agent_name', refs.agent_name
                        )
                        ORDER BY LOWER(COALESCE(refs.agent_name, refs.agent_id, refs.agent_internal_id))
                    ) AS related_agents,
                    COUNT(*)::int AS related_agent_count
                FROM (
                    SELECT DISTINCT
                        {abp_agent_id_expr} AS agent_id,
                        {abp_agent_internal_id_expr} AS agent_internal_id,
                        NULL::text AS agent_name
                    FROM core.agent_business_processes abp
                    WHERE {abp_filter}
                ) refs
            ) rel ON TRUE
        """
    else:
        rel_join_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_agents, 0::int AS related_agent_count
            ) rel ON TRUE
        """

    proc_rel_sql = """
        LEFT JOIN LATERAL (
            SELECT
                json_agg(
                    json_build_object(
                        'business_process_id', linked.other_process_id,
                        'process_name', bp2.process_name,
                        'relationship_type', linked.relationship_type
                    )
                    ORDER BY LOWER(COALESCE(bp2.process_name, linked.other_process_id))
                ) AS related_processes
            FROM (
                SELECT bp.parent_process_id AS other_process_id, 'PARENT'::text AS relationship_type
                WHERE bp.parent_process_id IS NOT NULL
                UNION
                SELECT child.business_process_id AS other_process_id, 'CHILD'::text AS relationship_type
                FROM core.business_processes child
                WHERE child.parent_process_id = bp.business_process_id
            ) linked
            LEFT JOIN core.business_processes bp2
                ON bp2.business_process_id = linked.other_process_id
            WHERE linked.other_process_id IS NOT NULL
              AND linked.other_process_id <> bp.business_process_id
        ) proc_rel ON TRUE
    """

    has_uc_proc_rel = await _table_exists(db, "core", "ai_use_case_business_processes")
    has_auc = await _table_exists(db, "core", "ai_use_cases")
    auc_order_sql = "ORDER BY 1"
    if has_auc:
        auc_cols = await _table_columns(db, "core", "ai_use_cases")
        order_parts: list[str] = []
        if "updated_ts" in auc_cols:
            order_parts.append("auc.updated_ts DESC NULLS LAST")
        if "created_ts" in auc_cols:
            order_parts.append("auc.created_ts DESC NULLS LAST")
        if "ai_use_case_id" in auc_cols:
            order_parts.append("auc.ai_use_case_id")
        if order_parts:
            auc_order_sql = f"ORDER BY {', '.join(order_parts)}"
    if has_uc_proc_rel and has_auc:
        uc_rel_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'identifier', related.ai_use_case_id,
                            'name', related.name,
                            'description', related.description,
                            'owner', related.owner,
                            'priority', related.priority,
                            'status', related.status
                        )
                        ORDER BY LOWER(COALESCE(related.name, related.ai_use_case_id))
                    ) AS related_use_cases
                FROM (
                    SELECT DISTINCT
                        rel.ai_use_case_id,
                        latest.name,
                        latest.description,
                        latest.owner,
                        latest.priority,
                        latest.status
                    FROM core.ai_use_case_business_processes rel
                    LEFT JOIN LATERAL (
                        SELECT
                            auc.name,
                            auc.description,
                            auc.owner,
                            auc.priority,
                            auc.status
                        FROM core.ai_use_cases auc
                        WHERE auc.ai_use_case_id = rel.ai_use_case_id
                        {auc_order_sql}
                        LIMIT 1
                    ) latest ON TRUE
                    WHERE rel.business_process_id = bp.business_process_id
                      AND rel.ai_use_case_id IS NOT NULL
                      AND rel.ai_use_case_id <> ''
                ) related
            ) uc_rel ON TRUE
        """
    elif has_uc_proc_rel:
        uc_rel_sql = """
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'identifier', related.ai_use_case_id,
                            'name', NULL,
                            'description', NULL,
                            'owner', NULL,
                            'priority', NULL,
                            'status', NULL
                        )
                        ORDER BY LOWER(related.ai_use_case_id)
                    ) AS related_use_cases
                FROM (
                    SELECT DISTINCT rel.ai_use_case_id
                    FROM core.ai_use_case_business_processes rel
                    WHERE rel.business_process_id = bp.business_process_id
                      AND rel.ai_use_case_id IS NOT NULL
                      AND rel.ai_use_case_id <> ''
                ) related
            ) uc_rel ON TRUE
        """
    else:
        uc_rel_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_use_cases
            ) uc_rel ON TRUE
        """

    search_clean = _clean(search)
    order_sql = (
        "LOWER(COALESCE(bp.process_name, bp.business_process_id))"
        if "process_name" in process_cols
        else "LOWER(bp.business_process_id)"
    )

    where_parts: list[str] = []
    query_params: dict[str, Any] = {}
    if process_id is not None:
        where_parts.append("bp.business_process_id = :process_id")
        query_params["process_id"] = process_id

    if search_clean:
        search_clauses = ["bp.business_process_id ILIKE :search_like"]
        if "process_name" in process_cols:
            search_clauses.append("COALESCE(bp.process_name, '') ILIKE :search_like")
        if "process_description" in process_cols:
            search_clauses.append("COALESCE(bp.process_description, '') ILIKE :search_like")
        where_parts.append("(" + " OR ".join(search_clauses) + ")")
        query_params["search_like"] = f"%{search_clean}%"

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    rows = await db.execute(
        text(
            f"""
            SELECT
                {", ".join(select_cols)}
            FROM core.business_processes bp
            LEFT JOIN core.business_processes parent
                ON parent.business_process_id = bp.parent_process_id
            {rel_join_sql}
            {proc_rel_sql}
            {uc_rel_sql}
            {where_sql}
            ORDER BY {order_sql}
            """
        ),
        query_params,
    )
    return [_normalize_process_row(dict(r._mapping)) for r in rows]


@router.get("/integrations", tags=["Integrations"], summary="List Integrations")
async def list_integrations(
    q: Optional[str] = Query(default=None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    try:
        all_items = await _fetch_integrations(db, search=q)
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": items,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list integrations: {exc}")


@router.get("/integrations/{integration_id}", tags=["Integrations"], summary="Get Integration")
async def get_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_integrations(db, integration_id=integration_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Integration '{integration_id}' not found",
        )
    return rows[0]


@router.post("/integrations", status_code=201, tags=["Integrations"], summary="Create Integration")
async def create_integration(
    body: IntegrationCreate = Body(default_factory=IntegrationCreate),
    company_id: Optional[str] = Query(None, description="Company UUID — when provided, syncs integration to Blueprint dimensions"),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_integrations_table(db)
    int_cols = await _table_columns(db, "core", "business_integrations")

    integration_id = uuid4().hex
    existing = await _fetch_integrations(db, integration_id=integration_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Integration '{integration_id}' already exists",
        )

    canonical = body.model_dump(exclude_unset=True)
    insert_values: dict[str, Any] = {"integration_id": integration_id}
    insert_values.update(
        _pick_text_columns(
            canonical,
            allowed_columns=_INTEGRATION_EDITABLE_COLUMNS,
            existing_columns=int_cols,
        )
    )

    if "created_ts" in int_cols:
        insert_values["created_ts"] = None
    if "updated_ts" in int_cols:
        insert_values["updated_ts"] = None

    insert_columns = [col for col in insert_values.keys() if col in int_cols]
    param_columns = [col for col in insert_columns if col not in {"created_ts", "updated_ts"}]
    params = {col: insert_values[col] for col in param_columns}

    columns_sql = ", ".join(insert_columns)
    values_sql = ", ".join(
        "CURRENT_TIMESTAMP" if col in {"created_ts", "updated_ts"} else f":{col}"
        for col in insert_columns
    )
    await db.execute(
        text(
            f"""
            INSERT INTO core.business_integrations ({columns_sql})
            VALUES ({values_sql})
            """
        ),
        params,
    )
    await db.commit()
    rows = await _fetch_integrations(db, integration_id=integration_id)
    if company_id and rows:
        await _sync_integration_to_dim_node(db, company_id, rows[0])
    return rows[0]


@router.patch("/integrations/{integration_id}", tags=["Integrations"], summary="Update Integration")
async def update_integration(
    integration_id: str,
    body: IntegrationUpdate = Body(default_factory=IntegrationUpdate),
    company_id: Optional[str] = Query(None, description="Company UUID — when provided, syncs integration to Blueprint dimensions"),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_integrations_table(db)
    int_cols = await _table_columns(db, "core", "business_integrations")
    existing = await _fetch_integrations(db, integration_id=integration_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"Integration '{integration_id}' not found",
        )

    canonical = body.model_dump(exclude_unset=True)
    updates = _pick_text_columns(
        canonical,
        allowed_columns=_INTEGRATION_EDITABLE_COLUMNS,
        existing_columns=int_cols,
    )
    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided for update")

    updates["integration_id"] = integration_id
    set_clause = ", ".join(f"{col} = :{col}" for col in updates.keys() if col != "integration_id")
    if "updated_ts" in int_cols:
        set_clause = f"{set_clause}, updated_ts = CURRENT_TIMESTAMP"

    await db.execute(
        text(
            f"""
            UPDATE core.business_integrations
            SET {set_clause}
            WHERE integration_id = :integration_id
            """
        ),
        updates,
    )
    await db.commit()
    rows = await _fetch_integrations(db, integration_id=integration_id)
    if company_id and rows:
        await _sync_integration_to_dim_node(db, company_id, rows[0])
    return rows[0]


@router.delete("/integrations/{integration_id}", tags=["Integrations"], summary="Delete Integration")
async def delete_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_integrations_table(db)
    result = await db.execute(
        text(
            """
            DELETE FROM core.business_integrations
            WHERE integration_id = :integration_id
            """
        ),
        {"integration_id": integration_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Integration '{integration_id}' not found",
        )
    await db.commit()
    return {"status": "deleted", "integration_id": integration_id}


@router.get("/applications", tags=["Applications"], summary="List Applications")
async def list_applications(
    q: Optional[str] = Query(default=None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    try:
        all_items = await _fetch_applications(db, search=q)
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": items,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list business applications: {exc}")


@router.get("/applications/{application_id}", tags=["Applications"], summary="Get Application")
async def get_application(
    application_id: str,
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_applications(db, application_id=application_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Application '{application_id}' not found",
    )
    return rows[0]

@router.post("/applications/suggest-description", tags=["Applications"], summary="Suggest Application Description")
async def suggest_application_description(body: SuggestApplicationDescriptionRequest):
    application_name = body.application_name.strip()
    if not application_name:
        raise HTTPException(status_code=400, detail="application_name is required")

    try:
        description = await _suggest_single_description(
            application_name,
            SUGGEST_APPLICATION_DESCRIPTION_SYSTEM,
            "business application",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return SuggestApplicationDescriptionResponse(description=description)


@router.post("/applications", status_code=201, tags=["Applications"], summary="Create Application")
async def create_application(
    body: ApplicationCreate = Body(default_factory=ApplicationCreate),
    db: AsyncSession = Depends(get_db),
):
    app_cols = await _table_columns(db, "core", "business_applications")
    canonical = _canonical_payload(body.model_dump(exclude_unset=True), _APPLICATION_ALIAS_MAP)

    app_id = uuid4().hex
    existing = await _fetch_applications(db, application_id=app_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Application '{app_id}' already exists",
        )

    insert_values: dict[str, Any] = {"business_application_id": app_id}
    insert_values.update(
        _pick_text_columns(
            canonical,
            allowed_columns=_APPLICATION_EDITABLE_COLUMNS,
            existing_columns=app_cols,
        )
    )

    for col, default_value in _APPLICATION_READONLY_DEFAULTS.items():
        if col in app_cols:
            insert_values[col] = default_value

    if "created_ts" in app_cols:
        insert_values["created_ts"] = None
    if "updated_ts" in app_cols:
        insert_values["updated_ts"] = None

    insert_columns = [col for col in insert_values.keys() if col in app_cols]
    param_columns = [col for col in insert_columns if col not in {"created_ts", "updated_ts"}]
    params = {col: insert_values[col] for col in param_columns}

    columns_sql = ", ".join(insert_columns)
    values_sql = ", ".join(
        "CURRENT_TIMESTAMP" if col in {"created_ts", "updated_ts"} else f":{col}"
        for col in insert_columns
    )
    await db.execute(
        text(
            f"""
            INSERT INTO core.business_applications ({columns_sql})
            VALUES ({values_sql})
            """
        ),
        params,
    )
    await db.commit()
    rows = await _fetch_applications(db, application_id=app_id)
    return rows[0]


@router.patch("/applications/{application_id}", tags=["Applications"], summary="Update Application")
async def update_application(
    application_id: str,
    body: ApplicationUpdate = Body(default_factory=ApplicationUpdate),
    db: AsyncSession = Depends(get_db),
):
    app_cols = await _table_columns(db, "core", "business_applications")
    existing = await _fetch_applications(db, application_id=application_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"Application '{application_id}' not found",
        )

    canonical = _canonical_payload(body.model_dump(exclude_unset=True), _APPLICATION_ALIAS_MAP)
    updates = _pick_text_columns(
        canonical,
        allowed_columns=_APPLICATION_EDITABLE_COLUMNS,
        existing_columns=app_cols,
    )
    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided for update")

    updates["business_application_id"] = application_id
    set_clause = ", ".join(f"{col} = :{col}" for col in updates.keys() if col != "business_application_id")
    if "updated_ts" in app_cols:
        set_clause = f"{set_clause}, updated_ts = CURRENT_TIMESTAMP"

    await db.execute(
        text(
            f"""
            UPDATE core.business_applications
            SET {set_clause}
            WHERE business_application_id = :business_application_id
            """
        ),
        updates,
    )
    await db.commit()
    rows = await _fetch_applications(db, application_id=application_id)
    return rows[0]


@router.delete("/applications/{application_id}", tags=["Applications"], summary="Delete Application")
async def delete_application(
    application_id: str,
    db: AsyncSession = Depends(get_db),
):
    if await _table_exists(db, "core", "agent_business_applications"):
        aba_cols = await _table_columns(db, "core", "agent_business_applications")
        if "business_application_id" in aba_cols:
            await db.execute(
                text(
                    """
                    DELETE FROM core.agent_business_applications
                    WHERE business_application_id = :business_application_id
                    """
                ),
                {"business_application_id": application_id},
            )

    await _ensure_application_attachments_table(db)
    await db.execute(
        text("DELETE FROM public.application_attachment WHERE application_id = :application_id"),
        {"application_id": application_id},
    )

    result = await db.execute(
        text(
            """
            DELETE FROM core.business_applications
            WHERE business_application_id = :business_application_id
            """
        ),
        {"business_application_id": application_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Application '{application_id}' not found",
        )
    await db.commit()
    return {"status": "deleted", "application_id": application_id}


@router.get("/processes", tags=["Processes"], summary="List Processes")
async def list_processes(
    q: Optional[str] = Query(default=None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    try:
        all_items = await _fetch_processes(db, search=q)
        total = len(all_items)
        items = all_items[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": items,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list business processes: {exc}")


@router.get("/processes/{process_id}", tags=["Processes"], summary="Get Process")
async def get_process(
    process_id: str,
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_processes(db, process_id=process_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Process '{process_id}' not found",
    )
    return rows[0]

@router.post("/processes/suggest-description", tags=["Processes"], summary="Suggest Process Description")
async def suggest_process_description(body: SuggestProcessDescriptionRequest):
    process_name = body.process_name.strip()
    if not process_name:
        raise HTTPException(status_code=400, detail="process_name is required")

    try:
        description = await _suggest_single_description(
            process_name,
            SUGGEST_PROCESS_DESCRIPTION_SYSTEM,
            "business process",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return SuggestProcessDescriptionResponse(description=description)


@router.post("/processes", status_code=201, tags=["Processes"], summary="Create Process")
async def create_process(
    body: ProcessCreate = Body(default_factory=ProcessCreate),
    db: AsyncSession = Depends(get_db),
):
    process_cols = await _table_columns(db, "core", "business_processes")
    canonical = _normalize_process_dropdown_values(
        _canonical_payload(body.model_dump(exclude_unset=True), _PROCESS_ALIAS_MAP)
    )

    process_id = uuid4().hex
    existing = await _fetch_processes(db, process_id=process_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Process '{process_id}' already exists",
        )

    parent_process_id = _text_or_none(canonical.get("parent_process_id"))
    if parent_process_id:
        if parent_process_id == process_id:
            raise HTTPException(status_code=400, detail="parent_process_id cannot reference itself")
        if not await _process_exists(db, parent_process_id):
            raise HTTPException(
                status_code=400,
                detail=f"Parent process '{parent_process_id}' does not exist",
            )
        canonical["parent_process_id"] = parent_process_id

    insert_values: dict[str, Any] = {"business_process_id": process_id}
    insert_values.update(
        _pick_text_columns(
            canonical,
            allowed_columns=_PROCESS_EDITABLE_COLUMNS,
            existing_columns=process_cols,
        )
    )

    for col, default_value in _PROCESS_READONLY_DEFAULTS.items():
        if col in process_cols:
            insert_values[col] = default_value

    if "created_ts" in process_cols:
        insert_values["created_ts"] = None
    if "updated_ts" in process_cols:
        insert_values["updated_ts"] = None

    insert_columns = [col for col in insert_values.keys() if col in process_cols]
    param_columns = [col for col in insert_columns if col not in {"created_ts", "updated_ts"}]
    params = {col: insert_values[col] for col in param_columns}

    columns_sql = ", ".join(insert_columns)
    values_sql = ", ".join(
        "CURRENT_TIMESTAMP" if col in {"created_ts", "updated_ts"} else f":{col}"
        for col in insert_columns
    )
    await db.execute(
        text(
            f"""
            INSERT INTO core.business_processes ({columns_sql})
            VALUES ({values_sql})
            """
        ),
        params,
    )
    await db.commit()
    rows = await _fetch_processes(db, process_id=process_id)
    return rows[0]


@router.patch("/processes/{process_id}", tags=["Processes"], summary="Update Process")
async def update_process(
    process_id: str,
    body: ProcessUpdate = Body(default_factory=ProcessUpdate),
    db: AsyncSession = Depends(get_db),
):
    process_cols = await _table_columns(db, "core", "business_processes")
    existing = await _fetch_processes(db, process_id=process_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"Process '{process_id}' not found",
        )

    canonical = _normalize_process_dropdown_values(
        _canonical_payload(body.model_dump(exclude_unset=True), _PROCESS_ALIAS_MAP)
    )
    updates = _pick_text_columns(
        canonical,
        allowed_columns=_PROCESS_EDITABLE_COLUMNS,
        existing_columns=process_cols,
    )
    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields provided for update")

    if "parent_process_id" in updates:
        parent_process_id = _text_or_none(updates.get("parent_process_id"))
        updates["parent_process_id"] = parent_process_id
        if parent_process_id:
            if parent_process_id == process_id:
                raise HTTPException(status_code=400, detail="parent_process_id cannot reference itself")
            if not await _process_exists(db, parent_process_id):
                raise HTTPException(
                    status_code=400,
                    detail=f"Parent process '{parent_process_id}' does not exist",
                )

    updates["business_process_id"] = process_id
    set_clause = ", ".join(f"{col} = :{col}" for col in updates.keys() if col != "business_process_id")
    if "updated_ts" in process_cols:
        set_clause = f"{set_clause}, updated_ts = CURRENT_TIMESTAMP"

    await db.execute(
        text(
            f"""
            UPDATE core.business_processes
            SET {set_clause}
            WHERE business_process_id = :business_process_id
            """
        ),
        updates,
    )
    await db.commit()
    rows = await _fetch_processes(db, process_id=process_id)
    return rows[0]


@router.delete("/processes/{process_id}", tags=["Processes"], summary="Delete Process")
async def delete_process(
    process_id: str,
    db: AsyncSession = Depends(get_db),
):
    if await _table_exists(db, "core", "agent_business_processes"):
        abp_cols = await _table_columns(db, "core", "agent_business_processes")
        if "business_process_id" in abp_cols:
            await db.execute(
                text(
                    """
                    DELETE FROM core.agent_business_processes
                    WHERE business_process_id = :business_process_id
                    """
                ),
                {"business_process_id": process_id},
            )

    if await _table_exists(db, "core", "ai_use_case_business_processes"):
        uc_proc_cols = await _table_columns(db, "core", "ai_use_case_business_processes")
        if "business_process_id" in uc_proc_cols:
            await db.execute(
                text(
                    """
                    DELETE FROM core.ai_use_case_business_processes
                    WHERE business_process_id = :business_process_id
                    """
                ),
                {"business_process_id": process_id},
            )

    await _ensure_process_attachments_table(db)
    await db.execute(
        text("DELETE FROM public.process_attachment WHERE process_id = :process_id"),
        {"process_id": process_id},
    )

    process_cols = await _table_columns(db, "core", "business_processes")
    if "parent_process_id" in process_cols:
        await db.execute(
            text(
                """
                UPDATE core.business_processes
                SET parent_process_id = NULL
                WHERE parent_process_id = :business_process_id
                """
            ),
            {"business_process_id": process_id},
        )

    result = await db.execute(
        text(
            """
            DELETE FROM core.business_processes
            WHERE business_process_id = :business_process_id
            """
        ),
        {"business_process_id": process_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Process '{process_id}' not found",
        )
    await db.commit()
    return {"status": "deleted", "process_id": process_id}


@router.get(
    "/agents/{agent_id}/attachments",
    tags=["Agents"],
    summary="List Agent Attachments",
)
async def list_agent_attachments(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
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


@router.post(
    "/agents/{agent_id}/attachments",
    tags=["Agents"],
    summary="Upload Agent Attachment",
    status_code=201,
)
async def create_agent_attachment(
    agent_id: str,
    body: AgentAttachmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_agent_attachments_table(db)

    filename = _clean(body.filename)
    mime_type = _clean(body.mime_type) or "application/octet-stream"
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


@router.get(
    "/agents/{agent_id}/attachments/{attachment_id}/download",
    tags=["Agents"],
    summary="Download Agent Attachment",
)
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


@router.delete(
    "/agents/{agent_id}/attachments/{attachment_id}",
    tags=["Agents"],
    summary="Delete Agent Attachment",
)
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


@router.get(
    "/applications/{application_id}/attachments",
    tags=["Applications"],
    summary="List Application Attachments",
)
async def list_application_attachments(
    application_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_application_attachments_table(db)

    rows = await db.execute(
        text(
            """
            SELECT id, application_id, filename, mime_type, file_size_bytes, created_at, updated_at
            FROM public.application_attachment
            WHERE application_id = :application_id
            ORDER BY created_at DESC
            """
        ),
        {"application_id": application_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post(
    "/applications/{application_id}/attachments",
    tags=["Applications"],
    summary="Upload Application Attachment",
    status_code=201,
)
async def create_application_attachment(
    application_id: str,
    body: EntityAttachmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_application_attachments_table(db)

    filename = _clean(body.filename)
    mime_type = _clean(body.mime_type) or "application/octet-stream"
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
            INSERT INTO public.application_attachment
                (application_id, filename, mime_type, file_size_bytes, file_data)
            VALUES
                (:application_id, :filename, :mime_type, :file_size_bytes, :file_data)
            RETURNING id, application_id, filename, mime_type, file_size_bytes, created_at, updated_at
            """
        ),
        {
            "application_id": application_id,
            "filename": filename,
            "mime_type": mime_type,
            "file_size_bytes": len(file_data),
            "file_data": file_data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get(
    "/applications/{application_id}/attachments/{attachment_id}/download",
    tags=["Applications"],
    summary="Download Application Attachment",
)
async def download_application_attachment(
    application_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_application_attachments_table(db)

    row = await db.execute(
        text(
            """
            SELECT filename, mime_type, file_data
            FROM public.application_attachment
            WHERE id = :attachment_id
              AND application_id = :application_id
            LIMIT 1
            """
        ),
        {"attachment_id": attachment_id, "application_id": application_id},
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


@router.delete(
    "/applications/{application_id}/attachments/{attachment_id}",
    tags=["Applications"],
    summary="Delete Application Attachment",
)
async def delete_application_attachment(
    application_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_application_attachments_table(db)

    result = await db.execute(
        text(
            """
            DELETE FROM public.application_attachment
            WHERE id = :attachment_id
              AND application_id = :application_id
            """
        ),
        {"attachment_id": attachment_id, "application_id": application_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"status": "deleted", "attachment_id": attachment_id}


@router.get(
    "/processes/{process_id}/attachments",
    tags=["Processes"],
    summary="List Process Attachments",
)
async def list_process_attachments(
    process_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_process_attachments_table(db)

    rows = await db.execute(
        text(
            """
            SELECT id, process_id, filename, mime_type, file_size_bytes, created_at, updated_at
            FROM public.process_attachment
            WHERE process_id = :process_id
            ORDER BY created_at DESC
            """
        ),
        {"process_id": process_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post(
    "/processes/{process_id}/attachments",
    tags=["Processes"],
    summary="Upload Process Attachment",
    status_code=201,
)
async def create_process_attachment(
    process_id: str,
    body: EntityAttachmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_process_attachments_table(db)

    filename = _clean(body.filename)
    mime_type = _clean(body.mime_type) or "application/octet-stream"
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
            INSERT INTO public.process_attachment
                (process_id, filename, mime_type, file_size_bytes, file_data)
            VALUES
                (:process_id, :filename, :mime_type, :file_size_bytes, :file_data)
            RETURNING id, process_id, filename, mime_type, file_size_bytes, created_at, updated_at
            """
        ),
        {
            "process_id": process_id,
            "filename": filename,
            "mime_type": mime_type,
            "file_size_bytes": len(file_data),
            "file_data": file_data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get(
    "/processes/{process_id}/attachments/{attachment_id}/download",
    tags=["Processes"],
    summary="Download Process Attachment",
)
async def download_process_attachment(
    process_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_process_attachments_table(db)

    row = await db.execute(
        text(
            """
            SELECT filename, mime_type, file_data
            FROM public.process_attachment
            WHERE id = :attachment_id
              AND process_id = :process_id
            LIMIT 1
            """
        ),
        {"attachment_id": attachment_id, "process_id": process_id},
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


@router.delete(
    "/processes/{process_id}/attachments/{attachment_id}",
    tags=["Processes"],
    summary="Delete Process Attachment",
)
async def delete_process_attachment(
    process_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_process_attachments_table(db)

    result = await db.execute(
        text(
            """
            DELETE FROM public.process_attachment
            WHERE id = :attachment_id
              AND process_id = :process_id
            """
        ),
        {"attachment_id": attachment_id, "process_id": process_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"status": "deleted", "attachment_id": attachment_id}


@router.get(
    "/agents/{agent_id}",
    tags=["Applications", "Processes"],
    summary="Get Agent Applications and Processes",
)
async def get_agent_relations(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    app_rows = await db.execute(
        text(
            """
            SELECT
                aba.business_application_id,
                COALESCE(ba.application_name, aba.application_name) AS application_name,
                ba.application_description,
                COALESCE(ba.business_criticality, aba.criticality) AS business_criticality,
                ba.emergency_tier,
                ba.business_owner,
                ba.application_portfolio_manager,
                ba.vendor_name,
                ba.it_application_owner,
                ba.inherent_risk_classification,
                ba.residual_risk_classification,
                ba.agent_risk_tier,
                ba.blended_risk_score
            FROM core.agent_business_applications aba
            LEFT JOIN core.business_applications ba
                ON ba.business_application_id = aba.business_application_id
            WHERE aba.agent_internal_id = :agent_internal_id
            ORDER BY LOWER(COALESCE(ba.application_name, aba.application_name, aba.business_application_id))
            """
        ),
        {"agent_internal_id": agent["agent_internal_id"]},
    )
    applications = [dict(r._mapping) for r in app_rows]

    process_rows = await db.execute(
        text(
            """
            SELECT
                abp.business_process_id,
                COALESCE(bp.process_name, abp.process_name) AS process_name,
                bp.process_description,
                COALESCE(bp.business_criticality, abp.criticality) AS business_criticality,
                bp.parent_process_id,
                parent.process_name AS parent_process_name,
                bp.owner,
                bp.stakeholders,
                bp.operators,
                bp.reputational_impact,
                bp.financial_impact,
                bp.regulatory_impact,
                bp.agent_risk_tier,
                bp.residual_risk_classification,
                bp.inherent_risk_classification,
                proc_rel.related_processes
            FROM core.agent_business_processes abp
            LEFT JOIN core.business_processes bp
                ON bp.business_process_id = abp.business_process_id
            LEFT JOIN core.business_processes parent
                ON parent.business_process_id = bp.parent_process_id
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'business_process_id', linked.other_process_id,
                            'process_name', bp2.process_name,
                            'relationship_type', linked.relationship_type
                        )
                        ORDER BY LOWER(COALESCE(bp2.process_name, linked.other_process_id))
                    ) AS related_processes
                FROM (
                    SELECT bp.parent_process_id AS other_process_id, 'PARENT'::text AS relationship_type
                    WHERE bp.parent_process_id IS NOT NULL
                    UNION
                    SELECT child.business_process_id AS other_process_id, 'CHILD'::text AS relationship_type
                    FROM core.business_processes child
                    WHERE child.parent_process_id = abp.business_process_id
                ) linked
                LEFT JOIN core.business_processes bp2
                    ON bp2.business_process_id = linked.other_process_id
                WHERE linked.other_process_id IS NOT NULL
                  AND linked.other_process_id <> abp.business_process_id
            ) proc_rel ON TRUE
            WHERE abp.agent_internal_id = :agent_internal_id
            ORDER BY LOWER(COALESCE(bp.process_name, abp.process_name, abp.business_process_id))
            """
        ),
        {"agent_internal_id": agent["agent_internal_id"]},
    )
    business_processes = []
    for row in process_rows:
        payload = dict(row._mapping)
        payload["related_processes"] = _json_list(payload.get("related_processes"))
        business_processes.append(payload)

    ai_use_cases: list[dict[str, Any]] = []
    has_agent_use_cases = await _table_exists(db, "core", "agent_ai_use_cases")
    if has_agent_use_cases:
        rel_cols = await _table_columns(db, "core", "agent_ai_use_cases")
        if "ai_use_case_id" in rel_cols:
            match_parts: list[str] = []
            tenant_filter = ""
            params: dict[str, Any] = {
                "agent_internal_id": agent.get("agent_internal_id"),
                "agent_id": agent.get("agent_id"),
                "agent_name": agent.get("agent_name"),
                "tenant_id": agent.get("tenant_id"),
            }

            if "agent_internal_id" in rel_cols:
                match_parts.append("rel.agent_internal_id = :agent_internal_id")
            if "agent_id" in rel_cols:
                match_parts.append("rel.agent_id = :agent_id")
            if "agent_name" in rel_cols and agent.get("agent_name"):
                match_parts.append("rel.agent_name = :agent_name")
            if "tenant_id" in rel_cols and agent.get("tenant_id"):
                tenant_filter = (
                    "AND (rel.tenant_id = :tenant_id OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
                )

            if match_parts:
                has_use_cases = await _table_exists(db, "core", "ai_use_cases")
                use_case_cols: set[str] = set()
                if has_use_cases:
                    use_case_cols = await _table_columns(db, "core", "ai_use_cases")

                rel_name_expr = "rel.ai_use_case_name" if "ai_use_case_name" in rel_cols else "NULL::text"
                uc_name_expr = "uc.name" if "name" in use_case_cols else "NULL::text"
                name_expr = f"COALESCE({uc_name_expr}, {rel_name_expr}, rel.ai_use_case_id)"

                description_expr = "uc.description" if "description" in use_case_cols else "NULL::text"
                owner_expr = "uc.owner" if "owner" in use_case_cols else "NULL::text"
                priority_expr = "uc.priority" if "priority" in use_case_cols else "NULL::text"
                status_expr = "uc.status" if "status" in use_case_cols else "NULL::text"

                uc_join = ""
                if has_use_cases and "ai_use_case_id" in use_case_cols:
                    tenant_join = ""
                    if "tenant_id" in use_case_cols and "tenant_id" in rel_cols:
                        tenant_join = "AND COALESCE(uc.tenant_id, '') = COALESCE(rel.tenant_id, '')"
                    uc_join = """
                    LEFT JOIN core.ai_use_cases uc
                        ON LOWER(TRIM(uc.ai_use_case_id)) = LOWER(TRIM(rel.ai_use_case_id))
                        {tenant_join}
                    """
                    uc_join = uc_join.format(tenant_join=tenant_join)

                use_case_rows = await db.execute(
                    text(
                        f"""
                        SELECT DISTINCT
                            rel.ai_use_case_id AS identifier,
                            {name_expr} AS name,
                            {description_expr} AS description,
                            {owner_expr} AS owner,
                            {priority_expr} AS priority,
                            {status_expr} AS status,
                            LOWER({name_expr}) AS _sort_key
                        FROM core.agent_ai_use_cases rel
                        {uc_join}
                        WHERE ({' OR '.join(match_parts)})
                          {tenant_filter}
                          AND rel.ai_use_case_id IS NOT NULL
                          AND rel.ai_use_case_id <> ''
                        ORDER BY _sort_key
                        """
                    ),
                    params,
                )
                ai_use_cases = [dict(r._mapping) for r in use_case_rows]

    # Agent-to-agent (parent/child) relationships are stored as a
    # self-reference on core.agents (parent_agent_internal_id), mirroring
    # core.business_processes.parent_process_id. We surface both directions:
    #   - agents whose parent is me        -> my children (direction CHILD)
    #   - the agent that is my parent       -> my parent  (direction PARENT)
    child_agents: list[dict[str, Any]] = []
    agent_cols = await _table_columns(db, "core", "agents")
    if "parent_agent_internal_id" in agent_cols:
        name_expr = "agent_name" if "agent_name" in agent_cols else "NULL::text"
        desc_expr = "agent_description" if "agent_description" in agent_cols else "NULL::text"
        child_rows = await db.execute(
            text(
                f"""
                SELECT agent_id, agent_internal_id, agent_name, agent_description, relationship_label, direction
                FROM (
                    -- Agents whose parent is me (my child agents)
                    SELECT
                        a.agent_id AS agent_id,
                        a.agent_internal_id AS agent_internal_id,
                        COALESCE(a.{name_expr}, a.agent_id) AS agent_name,
                        a.{desc_expr} AS agent_description,
                        NULL::text AS relationship_label,
                        'CHILD'::text AS direction
                    FROM core.agents a
                    WHERE a.parent_agent_internal_id = :agent_internal_id
                      AND COALESCE(a.is_current, true) = true
                    UNION
                    -- The agent that is my parent
                    SELECT
                        p.agent_id AS agent_id,
                        p.agent_internal_id AS agent_internal_id,
                        COALESCE(p.{name_expr}, p.agent_id) AS agent_name,
                        p.{desc_expr} AS agent_description,
                        NULL::text AS relationship_label,
                        'PARENT'::text AS direction
                    FROM core.agents me
                    JOIN core.agents p
                        ON p.agent_internal_id = me.parent_agent_internal_id
                        AND COALESCE(p.is_current, true) = true
                    WHERE me.agent_internal_id = :agent_internal_id
                      AND COALESCE(me.is_current, true) = true
                      AND COALESCE(me.parent_agent_internal_id, '') <> ''
                ) rel
                ORDER BY LOWER(COALESCE(agent_name, agent_id, ''))
                """
            ),
            {"agent_internal_id": agent["agent_internal_id"]},
        )
        child_agents = [dict(r._mapping) for r in child_rows]

    # AI Models linked to this agent (junction core.agent_ai_models -> core.ai_models).
    ai_models: list[dict[str, Any]] = []
    has_agent_ai_models = await _table_exists(db, "core", "agent_ai_models")
    if has_agent_ai_models:
        aam_cols = await _table_columns(db, "core", "agent_ai_models")
        if "ai_model_id" in aam_cols:
            has_models_catalog = await _table_exists(db, "core", "ai_models")
            model_cols: set[str] = set()
            if has_models_catalog:
                model_cols = await _table_columns(db, "core", "ai_models")
            rel_name_expr = "rel.model_name" if "model_name" in aam_cols else "NULL::text"
            cat_name_expr = "m.model_name" if "model_name" in model_cols else "NULL::text"
            name_expr = f"COALESCE({cat_name_expr}, {rel_name_expr}, rel.ai_model_id)"
            desc_expr = "m.description" if "description" in model_cols else "NULL::text"
            provider_expr = "m.provider" if "provider" in model_cols else "NULL::text"
            status_expr = "m.status" if "status" in model_cols else "NULL::text"
            join_sql = ""
            if has_models_catalog and "ai_model_id" in model_cols:
                join_sql = (
                    "LEFT JOIN core.ai_models m "
                    "ON LOWER(TRIM(m.ai_model_id)) = LOWER(TRIM(rel.ai_model_id))"
                )
            model_rows = await db.execute(
                text(
                    f"""
                    SELECT ai_model_id, model_name, description, provider, status
                    FROM (
                        SELECT DISTINCT
                            rel.ai_model_id AS ai_model_id,
                            {name_expr} AS model_name,
                            {desc_expr} AS description,
                            {provider_expr} AS provider,
                            {status_expr} AS status
                        FROM core.agent_ai_models rel
                        {join_sql}
                        WHERE rel.agent_internal_id = :agent_internal_id
                          AND rel.ai_model_id IS NOT NULL
                          AND rel.ai_model_id <> ''
                    ) sub
                    ORDER BY LOWER(model_name)
                    """
                ),
                {"agent_internal_id": agent["agent_internal_id"]},
            )
            ai_models = [dict(r._mapping) for r in model_rows]

    return {
        "agent": {
            "agent_id": agent.get("agent_id"),
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_name": agent.get("agent_name"),
            "tenant_id": agent.get("tenant_id"),
        },
        "applications": applications,
        "business_processes": business_processes,
        "ai_use_cases": ai_use_cases,
        "child_agents": child_agents,
        "ai_models": ai_models,
    }


@router.put(
    "/agents/{agent_id}/applications/{application_id}",
    tags=["Applications"],
    summary="Link Agent to Application",
)
async def add_agent_application_relation(
    agent_id: str,
    application_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    app_row = await db.execute(
        text(
            """
            SELECT
                business_application_id,
                application_name,
                business_criticality,
                emergency_tier,
                application_description
            FROM core.business_applications
            WHERE business_application_id = :business_application_id
            LIMIT 1
            """
        ),
        {"business_application_id": application_id},
    )
    app = app_row.mappings().first()

    if not app:
        await db.execute(
            text(
                """
                INSERT INTO core.business_applications (
                    tenant_id, business_application_id,
                    application_name, created_ts, updated_ts
                )
                VALUES (
                    :tenant_id, :business_application_id,
                    :application_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (business_application_id)
                DO NOTHING
                """
            ),
            {
                "tenant_id": agent.get("tenant_id"),
                "business_application_id": application_id,
                "application_name": application_id,
            },
        )
        app = {
            "application_name": application_id,
            "business_criticality": None,
        }

    await db.execute(
        text(
            """
            INSERT INTO core.agent_business_applications (
                tenant_id, business_application_id, agent_id, application_name, criticality,
                created_ts, updated_ts, agent_internal_id
            )
            VALUES (
                :tenant_id, :business_application_id, :agent_id, :application_name, :criticality,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :agent_internal_id
            )
            ON CONFLICT (agent_internal_id, business_application_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                application_name = EXCLUDED.application_name,
                criticality = EXCLUDED.criticality,
                updated_ts = EXCLUDED.updated_ts
            """
        ),
        {
            "tenant_id": agent.get("tenant_id"),
            "business_application_id": application_id,
            "agent_id": agent.get("agent_id"),
            "application_name": app.get("application_name") or application_id,
            "criticality": app.get("business_criticality"),
            "agent_internal_id": agent.get("agent_internal_id"),
        },
    )

    await _refresh_application_rollup(db, application_id)
    await db.commit()

    return {
        "status": "linked",
        "agent_id": agent_id,
        "application_id": application_id,
    }


@router.delete(
    "/agents/{agent_id}/applications/{application_id}",
    tags=["Applications"],
    summary="Unlink Agent from Application",
)
async def remove_agent_application_relation(
    agent_id: str,
    application_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    result = await db.execute(
        text(
            """
            DELETE FROM core.agent_business_applications
            WHERE business_application_id = :business_application_id
              AND (
                    agent_internal_id = :agent_internal_id
                    OR agent_id = :agent_id
                  )
            """
        ),
        {
            "business_application_id": application_id,
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_id": agent.get("agent_id"),
        },
    )

    await _refresh_application_rollup(db, application_id)
    await db.commit()

    return {
        "status": "unlinked",
        "agent_id": agent_id,
        "application_id": application_id,
        "rows_deleted": result.rowcount or 0,
    }


@router.put(
    "/agents/{agent_id}/processes/{process_id}",
    tags=["Processes"],
    summary="Link Agent to Process",
)
async def add_agent_process_relation(
    agent_id: str,
    process_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    process_row = await db.execute(
        text(
            """
            SELECT
                business_process_id,
                process_name,
                business_criticality
            FROM core.business_processes
            WHERE business_process_id = :business_process_id
            LIMIT 1
            """
        ),
        {"business_process_id": process_id},
    )
    process = process_row.mappings().first()

    if not process:
        await db.execute(
            text(
                """
                INSERT INTO core.business_processes (
                    tenant_id, business_process_id,
                    process_number, process_name, created_ts, updated_ts
                )
                VALUES (
                    :tenant_id, :business_process_id,
                    :process_number, :process_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (business_process_id)
                DO NOTHING
                """
            ),
            {
                "tenant_id": agent.get("tenant_id"),
                "business_process_id": process_id,
                "process_number": process_id,
                "process_name": process_id,
            },
        )
        process = {
            "process_name": process_id,
            "business_criticality": None,
        }

    await db.execute(
        text(
            """
            INSERT INTO core.agent_business_processes (
                tenant_id, business_process_id, agent_id, process_name, criticality,
                created_ts, updated_ts, agent_internal_id
            )
            VALUES (
                :tenant_id, :business_process_id, :agent_id, :process_name, :criticality,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :agent_internal_id
            )
            ON CONFLICT (agent_internal_id, business_process_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                process_name = EXCLUDED.process_name,
                criticality = EXCLUDED.criticality,
                updated_ts = EXCLUDED.updated_ts
            """
        ),
        {
            "tenant_id": agent.get("tenant_id"),
            "business_process_id": process_id,
            "agent_id": agent.get("agent_id"),
            "process_name": process.get("process_name") or process_id,
            "criticality": process.get("business_criticality"),
            "agent_internal_id": agent.get("agent_internal_id"),
        },
    )

    await _refresh_process_rollup(db, process_id)
    await db.commit()

    return {
        "status": "linked",
        "agent_id": agent_id,
        "process_id": process_id,
    }


@router.delete(
    "/agents/{agent_id}/processes/{process_id}",
    tags=["Processes"],
    summary="Unlink Agent from Process",
)
async def remove_agent_process_relation(
    agent_id: str,
    process_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    result = await db.execute(
        text(
            """
            DELETE FROM core.agent_business_processes
            WHERE business_process_id = :business_process_id
              AND (
                    agent_internal_id = :agent_internal_id
                    OR agent_id = :agent_id
                  )
            """
        ),
        {
            "business_process_id": process_id,
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_id": agent.get("agent_id"),
        },
    )

    await _refresh_process_rollup(db, process_id)
    await db.commit()

    return {
        "status": "unlinked",
        "agent_id": agent_id,
        "process_id": process_id,
        "rows_deleted": result.rowcount or 0,
    }


@router.put(
    "/agents/{agent_id}/child-agents/{child_agent_id}",
    tags=["Agents"],
    summary="Link Child Agent to Parent Agent",
)
async def add_child_agent_relation(
    agent_id: str,
    child_agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    if agent_id == child_agent_id:
        raise HTTPException(status_code=400, detail="An agent cannot be linked to itself.")

    agent_cols = await _table_columns(db, "core", "agents")
    if "parent_agent_internal_id" not in agent_cols:
        raise HTTPException(
            status_code=500,
            detail="core.agents.parent_agent_internal_id column not found",
        )

    parent = await _resolve_agent(db, agent_id)
    child = await _resolve_agent(db, child_agent_id)

    if parent.get("agent_internal_id") == child.get("agent_internal_id"):
        raise HTTPException(status_code=400, detail="An agent cannot be linked to itself.")

    # The relationship lives on the child row: set its parent pointer.
    # One parent -> many children; reassigns the child if it had another parent.
    await db.execute(
        text(
            """
            UPDATE core.agents
            SET parent_agent_internal_id = :parent_agent_internal_id,
                updated_ts = CURRENT_TIMESTAMP
            WHERE agent_internal_id = :child_agent_internal_id
            """
        ),
        {
            "parent_agent_internal_id": parent.get("agent_internal_id"),
            "child_agent_internal_id": child.get("agent_internal_id"),
        },
    )
    await db.commit()

    return {
        "status": "linked",
        "parent_agent_id": agent_id,
        "child_agent_id": child_agent_id,
    }


@router.delete(
    "/agents/{agent_id}/child-agents/{child_agent_id}",
    tags=["Agents"],
    summary="Unlink Agent-to-Agent Relation",
)
async def remove_child_agent_relation(
    agent_id: str,
    child_agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent_cols = await _table_columns(db, "core", "agents")
    if "parent_agent_internal_id" not in agent_cols:
        raise HTTPException(
            status_code=500,
            detail="core.agents.parent_agent_internal_id column not found",
        )

    agent_a = await _resolve_agent(db, agent_id)
    agent_b = await _resolve_agent(db, child_agent_id)

    a_internal = agent_a.get("agent_internal_id")
    b_internal = agent_b.get("agent_internal_id")

    # Clear the parent pointer regardless of which side is parent vs child, so
    # the link can be unlinked from either agent's Business Impact view.
    result = await db.execute(
        text(
            """
            UPDATE core.agents
            SET parent_agent_internal_id = NULL,
                updated_ts = CURRENT_TIMESTAMP
            WHERE (agent_internal_id = :a_internal AND parent_agent_internal_id = :b_internal)
               OR (agent_internal_id = :b_internal AND parent_agent_internal_id = :a_internal)
            """
        ),
        {
            "a_internal": a_internal,
            "b_internal": b_internal,
        },
    )
    await db.commit()

    return {
        "status": "unlinked",
        "agent_id": agent_id,
        "related_agent_id": child_agent_id,
        "rows_deleted": result.rowcount or 0,
    }
