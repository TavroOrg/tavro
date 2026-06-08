from __future__ import annotations
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
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

CORE    = os.getenv("CORE_DB_NAME",       "core")
CURATED = os.getenv("CURATED_DB_NAME",    "curated")
RISK    = os.getenv("RISK_MANAGEMENT_DB_NAME",  os.getenv("RISK_MANAGEMENT_DB_NAME", "risk_management"))
_RISK_URL = os.getenv("RISK_CLASSIFY_URL", "http://localhost:8000/api/v1/risk/classify-risk")


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
    tools: Optional[List[Dict[str, str]]] = None
    knowledge_source: Optional[Dict[str, str]] = None


class AgentUpdateRequest(BaseModel):
    agent_name: Optional[str] = None
    description: Optional[str] = None
    instruction: Optional[str] = None

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
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 49

    tenant_id = _require_tenant(request)
    params: Dict[str, Any] = {"start": start, "end": end, "tid": tenant_id}
    where = "WHERE (tenant_id = :tid OR tenant_id IS NULL)"

    try:
        result = await db.execute(
            text(f"""
                SELECT *, ROW_NUMBER() OVER () AS rn, COUNT(*) OVER () AS total_records
                FROM (
                    SELECT * FROM {CURATED}.agent_360
                    {where}
                ) t
            """),
            params,
        )
        rows = result.mappings().all()
        total = int(rows[0]["total_records"]) if rows else 0
        data = [{k: v for k, v in r.items() if k not in ("rn", "total_records")} for r in rows
                if start <= r["rn"] <= end]
        return {"start_record": start, "end_record": end, "record_count": len(data),
                "total_records": total, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _agent_card_dir() -> Path:
    return Path(os.getenv("LOCAL_AGENT_CARD_DIR", "./agent_cards"))


def _write_agent_card(
    agent_id: str,
    agent_internal_id: str,
    agent_name: str,
    description: str,
    instruction: str,
    tools: Optional[List[Dict[str, str]]] = None,
    knowledge_source: Optional[Dict[str, str]] = None,
) -> None:
    """Write a full agent card JSON file immediately after creation so get_agent_card returns complete details."""
    try:
        card_dir = _agent_card_dir()
        card_dir.mkdir(parents=True, exist_ok=True)

        tool_entries = []
        data_source_entries = []
        if tools:
            for tool in tools:
                tool_id = str(uuid.uuid4())
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

        ks_entry = None
        if knowledge_source:
            ks_entry = {
                "identifier": None,
                "name": knowledge_source.get("name"),
                "access_mechanism": None,
            }

        card = {
            "capabilities": {"streaming": False},
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
            "name": agent_name,
            "description": description,
            "preferredTransport": None,
            "protocol_version": None,
            "instruction_sets": [],
            "skills": [],
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
    db: AsyncSession = Depends(get_db),
):
    agent_id = str(uuid.uuid4())
    agent_internal_id = str(uuid.uuid4())
    tenant_id = _require_tenant(request)

    try:
        await db.execute(
            text(f"""
                INSERT INTO {CORE}.agents
                    (tenant_id, agent_internal_id, agent_id, agent_name, agent_description,
                     created_ts, updated_ts, is_current)
                VALUES
                    (:tid, :iid, :aid, :name, :desc,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
            """),
            {"tid": tenant_id, "iid": agent_internal_id, "aid": agent_id,
             "name": body.agent_name, "desc": body.description},
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

        for tool in (body.tools or []):
            tool_id = str(uuid.uuid4())
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_tools
                        (tenant_id, agent_internal_id, tool_id, agent_id,
                         tool_name, tool_description, created_ts, updated_ts)
                    VALUES
                        (:tid, :iid, :tool_id, :aid,
                         :tname, :tdesc, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """),
                {"tid": tenant_id, "iid": agent_internal_id, "tool_id": tool_id,
                 "aid": agent_id, "tname": tool.get("name", ""), "tdesc": tool.get("description", "")},
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
                    contains_pii, contains_phi, contains_pci
                ) VALUES (
                    :tid, :aid, :iid, :name, :desc,
                    CURRENT_TIMESTAMP,
                    0, 0, 0, 0, 0,
                    false, false, false
                )
                ON CONFLICT (agent_internal_id) DO NOTHING
            """),
            {"tid": tenant_id, "aid": agent_id, "iid": agent_internal_id,
             "name": body.agent_name, "desc": body.description},
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
        tools=body.tools,
        knowledge_source=body.knowledge_source,
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
        return dict(row)
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
            text(f"SELECT 1 FROM {CORE}.agents WHERE agent_id = :aid AND tenant_id = :tid LIMIT 1"),
            {"aid": agent_id, "tid": tenant_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

        agent_sets = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"aid": agent_id, "tid": tenant_id}

        if body.agent_name and body.agent_name.strip():
            agent_sets.append("agent_name = :name")
            params["name"] = body.agent_name.strip()
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
