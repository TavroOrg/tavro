from __future__ import annotations
import json
import os
import base64
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()

CORE = os.getenv("CORE_DB_NAME", "core")
_USE_CASE_ATTACHMENTS_READY = False

_PRIORITY_MAP: Dict[str, str] = {
    "1": "1 - Critical", "critical": "1 - Critical",
    "2": "2 - High",     "high": "2 - High",
    "3": "3 - Moderate", "moderate": "3 - Moderate", "medium": "3 - Moderate",
    "4": "4 - Low",      "low": "4 - Low",
    "5": "5 - Planning", "planning": "5 - Planning",
    "1 - critical": "1 - Critical",
    "2 - high":     "2 - High",
    "3 - moderate": "3 - Moderate",
    "4 - low":      "4 - Low",
    "5 - planning": "5 - Planning",
}


def _normalize_priority(raw: str) -> str:
    lower = raw.strip().lower()
    if lower in _PRIORITY_MAP:
        return _PRIORITY_MAP[lower]
    m = re.match(r"^\s*0*([1-5])\b", lower)
    if m:
        return _PRIORITY_MAP[m.group(1)]
    return raw.strip()


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


def _norm_id(value: str) -> str:
    return (value or "").strip()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class UseCaseCreateRequest(BaseModel):
    title: str
    description: str
    business_problem_statement: str
    expected_benefits: str
    priority: str
    regulatory_impact: Optional[List[str]] = None
    solution_approach: Optional[str] = None
    use_case_owner: Optional[str] = None
    impacted_business_applications: Optional[List[str]] = None
    impacted_business_processes: Optional[List[str]] = None


class UseCaseUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    business_problem_statement: Optional[str] = None
    expected_benefits: Optional[str] = None
    priority: Optional[str] = None
    solution_approach: Optional[str] = None
    use_case_owner: Optional[str] = None


class LinkAgentRequest(BaseModel):
    agent_id: str

class LinkProcessRequest(BaseModel):
    process_id: str


class UseCaseAttachmentCreate(BaseModel):
    filename: str
    mime_type: str
    content_base64: str

class SuggestUseCaseDescriptionRequest(BaseModel):
    title: str


class SuggestUseCaseDescriptionResponse(BaseModel):
    description: str


SUGGEST_USE_CASE_DESCRIPTION_SYSTEM = """You are helping a user create an AI use case in Tavro.

Given only a use case name, generate a short plain-text description of what the use case likely does.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Be specific and practical, but do not invent integrations, company-specific facts, or implementation details.
- Focus on the likely business problem, workflow, and expected value based on the name alone.
- Do not assume a specific technical approach such as machine learning, LLMs, OCR, NLP, real-time processing, APIs, or automation patterns unless that is explicit in the name.
- If the name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence AI use case description"
}"""


async def _ensure_use_case_process_relation_table(db: AsyncSession) -> None:
    await db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {CORE}.ai_use_case_business_processes (
                tenant_id TEXT,
                ai_use_case_id TEXT,
                business_process_id TEXT,
                process_name TEXT,
                created_ts TIMESTAMP,
                updated_ts TIMESTAMP
            )
            """
        )
    )
    await db.execute(
        text(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_use_case_business_processes
            ON {CORE}.ai_use_case_business_processes (ai_use_case_id, business_process_id, tenant_id)
            """
        )
    )


async def _ensure_use_case_attachments_table(db: AsyncSession) -> None:
    global _USE_CASE_ATTACHMENTS_READY
    if _USE_CASE_ATTACHMENTS_READY:
        return

    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.use_case_attachment (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                use_case_id TEXT NOT NULL,
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
            CREATE INDEX IF NOT EXISTS use_case_attachment_use_case_idx
            ON public.use_case_attachment (use_case_id, created_at DESC)
            """
        )
    )
    await db.commit()
    _USE_CASE_ATTACHMENTS_READY = True

@router.post("/suggest-description", response_model=SuggestUseCaseDescriptionResponse, summary="Suggest AI Use Case Description")
async def suggest_use_case_description(body: SuggestUseCaseDescriptionRequest):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    provider, api_key = _resolve_agent_llm()
    user_prompt = f"""Generate a concise description for this AI use case:

Use case name: {title}

Return ONLY the JSON object with the "description" field."""

    if provider == "openai":
        data = await _call_openai(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_USE_CASE_DESCRIPTION_SYSTEM,
            300,
        )
    else:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_USE_CASE_DESCRIPTION_SYSTEM,
            tools=None,
            max_tokens=300,
        )

    raw = _collect_text(data).strip()
    try:
        parsed = json.loads(_extract_json(raw))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return SuggestUseCaseDescriptionResponse(
        description=str(parsed.get("description", "")).strip(),
    )


# ---------------------------------------------------------------------------
# GET /  — list use cases
# ---------------------------------------------------------------------------

@router.get("/", summary="List AI Use Cases")
async def list_use_cases(
    request: Request,
    title: Optional[str] = None,
    process_id: Optional[str] = None,
    start_record: int = 1,
    record_range: str = "1-10",
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 9

    tenant_id = _tenant(request)
    where_clauses: List[str] = []
    params: Dict[str, Any] = {}

    if tenant_id:
        where_clauses.append(
            "(tenant_id = :tid OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
        )
        params["tid"] = tenant_id
    if title:
        where_clauses.append("LOWER(name) LIKE LOWER(:title)")
        params["title"] = f"%{title}%"
    if process_id and process_id.strip():
        normalized_process_id = _norm_id(process_id)
        await _ensure_use_case_process_relation_table(db)
        process_filter = [
            "LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(identifier))",
            "LOWER(TRIM(rel.business_process_id)) = LOWER(TRIM(:process_id))",
        ]
        if tenant_id:
            process_filter.append(
                "(rel.tenant_id = :tid OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
            )
        where_clauses.append(
            "EXISTS (SELECT 1 FROM "
            f"{CORE}.ai_use_case_business_processes rel WHERE {' AND '.join(process_filter)})"
        )
        params["process_id"] = normalized_process_id

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    try:
        result = await db.execute(
            text(f"""
                SELECT *
                FROM (
                    SELECT DISTINCT ON (identifier)
                        identifier, name, description, owner, problem_statement,
                        expected_benefits, priority, status, solution_approach, created_ts,
                        ROW_NUMBER() OVER (ORDER BY created_ts DESC) AS rn,
                        COUNT(*) OVER () AS total_records
                    FROM {CORE}.agent_ai_use_cases
                    {"WHERE identifier IS NOT NULL AND identifier != '' AND " + where_sql[6:] if where_sql else "WHERE identifier IS NOT NULL AND identifier != ''"}
                    ORDER BY identifier, created_ts DESC
                ) t
                WHERE rn BETWEEN :start AND :end
            """),
            {**params, "start": start, "end": end},
        )
        rows = result.mappings().all()
        total = int(rows[0]["total_records"]) if rows else 0
        data = [{k: v for k, v in r.items() if k not in ("rn", "total_records")} for r in rows]
        return {"start_record": start, "end_record": end, "record_count": len(data),
                "total_records": total, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /  — create use case
# ---------------------------------------------------------------------------

@router.post("/", summary="Create AI Use Case", status_code=201)
async def create_use_case(body: UseCaseCreateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    use_case_id = str(uuid.uuid4())
    tenant_id = _tenant(request)
    try:
        priority = _normalize_priority(body.priority)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        await db.execute(
            text(f"""
                INSERT INTO {CORE}.agent_ai_use_cases
                    (tenant_id, identifier, name, description, owner,
                     problem_statement, expected_benefits, priority, status,
                     solution_approach, created_ts, updated_ts, agent_internal_id)
                VALUES
                    (:tid, :uid, :name, :desc, :owner,
                     :problem, :benefits, :priority, 'New',
                     :solution, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
            """),
            {
                "tid": tenant_id, "uid": use_case_id,
                "name": body.title, "desc": body.description,
                "owner": body.use_case_owner or "System Administrator",
                "problem": body.business_problem_statement,
                "benefits": body.expected_benefits,
                "priority": priority,
                "solution": body.solution_approach or "",
            },
        )
        await db.commit()
        return {"message": "AI Use Case registered successfully.", "use_case_id": use_case_id}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# GET /{use_case_id}  — get single use case with linked agents
# ---------------------------------------------------------------------------

@router.get("/{use_case_id}", summary="Get AI Use Case")
async def get_use_case(use_case_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _tenant(request)
    normalized_use_case_id = _norm_id(use_case_id)
    use_case_tenant_filter = (
        "AND (u.tenant_id = :tid OR u.tenant_id IS NULL OR u.tenant_id = '' OR u.tenant_id = 'None')"
        if tenant_id
        else ""
    )
    agent_tenant_filter = (
        "AND (rel.tenant_id = :tid OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
        if tenant_id
        else ""
    )
    process_tenant_filter = (
        "AND (relp.tenant_id = :tid OR relp.tenant_id IS NULL OR relp.tenant_id = '' OR relp.tenant_id = 'None')"
        if tenant_id
        else ""
    )
    try:
        result = await db.execute(
            text(f"""
                SELECT
                    u.identifier, u.name, u.description, u.owner,
                    u.problem_statement, u.expected_benefits, u.priority,
                    u.status, u.solution_approach, u.created_ts, u.updated_ts,
                    u.agent_risk_exposure_are, u.no_of_associated_agents,
                    u.inherent_risk_classification, u.residual_risk_classification,
                    u.inherent_risk_classification_score, u.residual_risk_classification_score,
                    u.agent_risk_tier_art
                FROM {CORE}.agent_ai_use_cases u
                WHERE LOWER(TRIM(u.identifier)) = LOWER(TRIM(:uid))
                  {use_case_tenant_filter}
                ORDER BY u.updated_ts DESC NULLS LAST
                LIMIT 1
            """),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        agents_result = await db.execute(
            text(f"""
                SELECT DISTINCT rel.agent_id, ag.agent_name AS name, ai.environment
                FROM {CORE}.agent_ai_use_cases rel
                LEFT JOIN {CORE}.agents ag
                    ON ag.agent_id = rel.agent_id AND ag.is_current = true
                LEFT JOIN {CORE}.agent_identifications ai
                    ON ai.agent_internal_id = rel.agent_internal_id
                    AND COALESCE(ai.is_current, true) = true
                WHERE LOWER(TRIM(rel.identifier)) = LOWER(TRIM(:uid)) AND rel.agent_id IS NOT NULL
                  {agent_tenant_filter}
                ORDER BY name NULLS LAST
            """),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        linked_agents = [dict(r) for r in agents_result.mappings().all()]

        await _ensure_use_case_process_relation_table(db)
        processes_result = await db.execute(
            text(
                f"""
                SELECT DISTINCT
                    relp.business_process_id,
                    COALESCE(bp.process_name, relp.process_name, relp.business_process_id) AS process_name,
                    bp.process_description AS description,
                    bp.business_criticality,
                    LOWER(COALESCE(bp.process_name, relp.process_name, relp.business_process_id)) AS process_sort_key
                FROM {CORE}.ai_use_case_business_processes relp
                LEFT JOIN {CORE}.business_processes bp
                    ON bp.business_process_id = relp.business_process_id
                WHERE LOWER(TRIM(relp.ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND relp.business_process_id IS NOT NULL
                  AND relp.business_process_id <> ''
                  {process_tenant_filter}
                ORDER BY process_sort_key
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        linked_processes = [
            {
                "identifier": r["business_process_id"],
                "business_process_id": r["business_process_id"],
                "name": r["process_name"],
                "process_name": r["process_name"],
                "description": r["description"],
                "business_criticality": r["business_criticality"],
            }
            for r in processes_result.mappings().all()
        ]

        data = {
            **dict(row),
            "of_associated_agents": linked_agents,
            "of_associated_business_processes": linked_processes,
        }
        return {"start_record": 1, "end_record": 1, "record_count": 1, "total_records": 1, "data": [data]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# PUT /{use_case_id}  — update use case
# ---------------------------------------------------------------------------

@router.put("/{use_case_id}", summary="Update AI Use Case")
async def update_use_case(use_case_id: str, body: UseCaseUpdateRequest, db: AsyncSession = Depends(get_db)):
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid LIMIT 1"),
            {"uid": use_case_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")

        sets: List[str] = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"uid": use_case_id}

        if body.title and body.title.strip():
            sets.append("name = :name")
            params["name"] = body.title.strip()
        if body.description and body.description.strip():
            sets.append("description = :desc")
            params["desc"] = body.description.strip()
        if body.business_problem_statement and body.business_problem_statement.strip():
            sets.append("problem_statement = :problem")
            params["problem"] = body.business_problem_statement.strip()
        if body.expected_benefits and body.expected_benefits.strip():
            sets.append("expected_benefits = :benefits")
            params["benefits"] = body.expected_benefits.strip()
        if body.priority and body.priority.strip():
            sets.append("priority = :priority")
            params["priority"] = _normalize_priority(body.priority)
        if body.solution_approach is not None:
            sets.append("solution_approach = :solution")
            params["solution"] = body.solution_approach.strip()
        if body.use_case_owner and body.use_case_owner.strip():
            sets.append("owner = :owner")
            params["owner"] = body.use_case_owner.strip()

        await db.execute(
            text(f"UPDATE {CORE}.agent_ai_use_cases SET {', '.join(sets)} WHERE identifier = :uid"),
            params,
        )
        await db.commit()
        return {"message": "AI Use Case updated successfully.", "use_case_id": use_case_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{use_case_id}  — delete all rows for this use case
# ---------------------------------------------------------------------------

@router.delete("/{use_case_id}", summary="Delete AI Use Case")
async def delete_use_case(use_case_id: str, db: AsyncSession = Depends(get_db)):
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid LIMIT 1"),
            {"uid": use_case_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")

        await _ensure_use_case_process_relation_table(db)
        await _ensure_use_case_attachments_table(db)
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_use_case_business_processes WHERE ai_use_case_id = :uid"),
            {"uid": use_case_id},
        )
        await db.execute(
            text("DELETE FROM public.use_case_attachment WHERE use_case_id = :uid"),
            {"uid": use_case_id},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid"),
            {"uid": use_case_id},
        )
        await db.commit()
        return {"message": "AI Use Case deleted successfully.", "use_case_id": use_case_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{use_case_id}/agents  — link agent
# ---------------------------------------------------------------------------

@router.post("/{use_case_id}/agents", summary="Link Agent to AI Use Case")
async def link_agent(use_case_id: str, body: LinkAgentRequest, request: Request, db: AsyncSession = Depends(get_db)):
    agent_id = body.agent_id
    tenant_id = _tenant(request)
    try:
        agent_row = await db.execute(
            text(f"SELECT agent_internal_id FROM {CORE}.agents WHERE agent_id = :aid AND is_current = true LIMIT 1"),
            {"aid": agent_id},
        )
        agent = agent_row.mappings().first()
        if not agent:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        agent_internal_id = str(agent["agent_internal_id"])

        dup = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid AND agent_id = :aid LIMIT 1"),
            {"uid": use_case_id, "aid": agent_id},
        )
        if dup.first():
            cnt = await db.execute(
                text(f"SELECT COUNT(DISTINCT agent_id) FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid AND agent_id IS NOT NULL"),
                {"uid": use_case_id},
            )
            return {"message": "Relationship already exists", "associated_count": cnt.scalar() or 0}

        base = await db.execute(
            text(f"SELECT agent_id FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid ORDER BY created_ts LIMIT 1"),
            {"uid": use_case_id},
        )
        base_row = base.mappings().first()
        if not base_row:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")

        is_placeholder = not base_row["agent_id"] or str(base_row["agent_id"]).strip() == ""

        if is_placeholder:
            await db.execute(
                text(f"""
                    UPDATE {CORE}.agent_ai_use_cases
                    SET agent_id = :aid, agent_internal_id = :iid, updated_ts = CURRENT_TIMESTAMP
                    WHERE identifier = :uid AND (agent_id IS NULL OR agent_id = '')
                """),
                {"aid": agent_id, "iid": agent_internal_id, "uid": use_case_id},
            )
        else:
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_ai_use_cases
                        (agent_id, agent_internal_id, identifier, name, description, owner,
                         problem_statement, expected_benefits, priority, status,
                         solution_approach, created_ts, updated_ts, tenant_id)
                    SELECT
                        :aid, :iid, identifier, name, description, owner,
                        problem_statement, expected_benefits, priority, status,
                        solution_approach, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, tenant_id
                    FROM {CORE}.agent_ai_use_cases
                    WHERE identifier = :uid
                    LIMIT 1
                """),
                {"aid": agent_id, "iid": agent_internal_id, "uid": use_case_id},
            )

        cnt_row = await db.execute(
            text(f"SELECT COUNT(DISTINCT agent_id) FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid AND agent_id IS NOT NULL"),
            {"uid": use_case_id},
        )
        new_count = int(cnt_row.scalar() or 0)

        await db.execute(
            text(f"UPDATE {CORE}.agent_ai_use_cases SET no_of_associated_agents = :cnt WHERE identifier = :uid"),
            {"cnt": new_count, "uid": use_case_id},
        )
        await db.commit()
        return {"message": "Relationship synchronized", "associated_count": new_count}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{use_case_id}/agents/{agent_id}  — unlink agent
# ---------------------------------------------------------------------------

@router.delete("/{use_case_id}/agents/{agent_id}", summary="Unlink Agent from AI Use Case")
async def unlink_agent(use_case_id: str, agent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        linked = await db.execute(
            text(f"SELECT agent_id FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid"),
            {"uid": use_case_id},
        )
        all_rows = linked.mappings().all()
        if not all_rows:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")

        linked_ids = [str(r["agent_id"]) for r in all_rows if r["agent_id"] and str(r["agent_id"]).strip()]

        if agent_id not in linked_ids:
            return {"message": "Relationship not found", "associated_count": len(linked_ids)}

        if len(linked_ids) == 1:
            await db.execute(
                text(f"""
                    UPDATE {CORE}.agent_ai_use_cases
                    SET agent_id = NULL, agent_internal_id = NULL,
                        no_of_associated_agents = 0, updated_ts = CURRENT_TIMESTAMP
                    WHERE identifier = :uid AND agent_id = :aid
                """),
                {"uid": use_case_id, "aid": agent_id},
            )
            new_count = 0
        else:
            await db.execute(
                text(f"DELETE FROM {CORE}.agent_ai_use_cases WHERE identifier = :uid AND agent_id = :aid"),
                {"uid": use_case_id, "aid": agent_id},
            )
            new_count = len(linked_ids) - 1
            await db.execute(
                text(f"UPDATE {CORE}.agent_ai_use_cases SET no_of_associated_agents = :cnt WHERE identifier = :uid"),
                {"cnt": new_count, "uid": use_case_id},
            )

        await db.commit()
        return {"message": "Relationship removed", "associated_count": new_count}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{use_case_id}/processes  — link business process
# ---------------------------------------------------------------------------

@router.post("/{use_case_id}/processes", summary="Link Process to AI Use Case")
async def link_process(use_case_id: str, body: LinkProcessRequest, request: Request, db: AsyncSession = Depends(get_db)):
    normalized_use_case_id = _norm_id(use_case_id)
    requested_process_id = _norm_id(body.process_id)
    if not normalized_use_case_id:
        raise HTTPException(status_code=400, detail="AI Use Case ID is required.")
    if not requested_process_id:
        raise HTTPException(status_code=400, detail="Process ID is required.")

    tenant_id = _tenant(request)
    tenant_filter = (
        "AND (tenant_id = :tid OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
        if tenant_id
        else ""
    )

    try:
        await _ensure_use_case_process_relation_table(db)

        uc_exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agent_ai_use_cases WHERE LOWER(TRIM(identifier)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        if not uc_exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        process_row = await db.execute(
            text(f"""
                SELECT business_process_id, process_name
                FROM {CORE}.business_processes
                WHERE LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                {tenant_filter}
                LIMIT 1
            """),
            {"pid": requested_process_id, "tid": tenant_id},
        )
        process = process_row.mappings().first()
        if not process:
            raise HTTPException(status_code=404, detail=f"Process '{requested_process_id}' not found.")
        canonical_process_id = _norm_id(str(process.get("business_process_id") or requested_process_id))

        dup = await db.execute(
            text(f"""
                SELECT 1
                FROM {CORE}.ai_use_case_business_processes
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                  {tenant_filter}
                LIMIT 1
            """),
            {"uid": normalized_use_case_id, "pid": canonical_process_id, "tid": tenant_id},
        )
        if dup.first():
            cnt = await db.execute(
                text(f"""
                    SELECT COUNT(DISTINCT business_process_id)
                    FROM {CORE}.ai_use_case_business_processes
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                    {tenant_filter}
                """),
                {"uid": normalized_use_case_id, "tid": tenant_id},
            )
            return {"message": "Relationship already exists", "associated_count": int(cnt.scalar() or 0)}

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_use_case_business_processes (
                    tenant_id, ai_use_case_id, business_process_id, process_name, created_ts, updated_ts
                )
                VALUES (
                    :tid, :uid, :pid, :pname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """),
            {
                "tid": tenant_id,
                "uid": normalized_use_case_id,
                "pid": canonical_process_id,
                "pname": process.get("process_name") or canonical_process_id,
            },
        )

        cnt = await db.execute(
            text(f"""
                SELECT COUNT(DISTINCT business_process_id)
                FROM {CORE}.ai_use_case_business_processes
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                {tenant_filter}
            """),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        await db.commit()
        return {"message": "Relationship synchronized", "associated_count": int(cnt.scalar() or 0)}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{use_case_id}/processes/{process_id}  — unlink business process
# ---------------------------------------------------------------------------

@router.delete("/{use_case_id}/processes/{process_id}", summary="Unlink Process from AI Use Case")
async def unlink_process(use_case_id: str, process_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    normalized_use_case_id = _norm_id(use_case_id)
    normalized_process_id = _norm_id(process_id)
    if not normalized_use_case_id:
        raise HTTPException(status_code=400, detail="AI Use Case ID is required.")
    if not normalized_process_id:
        raise HTTPException(status_code=400, detail="Process ID is required.")

    tenant_id = _tenant(request)
    tenant_filter = (
        "AND (tenant_id = :tid OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
        if tenant_id
        else ""
    )

    try:
        await _ensure_use_case_process_relation_table(db)

        uc_exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agent_ai_use_cases WHERE LOWER(TRIM(identifier)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        if not uc_exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        exists = await db.execute(
            text(f"""
                SELECT 1
                FROM {CORE}.ai_use_case_business_processes
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                  {tenant_filter}
                LIMIT 1
            """),
            {"uid": normalized_use_case_id, "pid": normalized_process_id, "tid": tenant_id},
        )
        if not exists.first():
            fallback_exists = await db.execute(
                text(
                    f"""
                    SELECT 1
                    FROM {CORE}.ai_use_case_business_processes
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                      AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                    LIMIT 1
                    """
                ),
                {"uid": normalized_use_case_id, "pid": normalized_process_id},
            )
            if fallback_exists.first():
                # Data-healing fallback: remove legacy/misaligned tenant rows for this exact relation.
                await db.execute(
                    text(
                        f"""
                        DELETE FROM {CORE}.ai_use_case_business_processes
                        WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                          AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                        """
                    ),
                    {"uid": normalized_use_case_id, "pid": normalized_process_id},
                )
                cnt = await db.execute(
                    text(f"""
                        SELECT COUNT(DISTINCT business_process_id)
                        FROM {CORE}.ai_use_case_business_processes
                        WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                        {tenant_filter}
                    """),
                    {"uid": normalized_use_case_id, "tid": tenant_id},
                )
                await db.commit()
                return {
                    "message": "Relationship removed",
                    "associated_count": int(cnt.scalar() or 0),
                    "rows_deleted": 1,
                }

            cnt = await db.execute(
                text(f"""
                    SELECT COUNT(DISTINCT business_process_id)
                    FROM {CORE}.ai_use_case_business_processes
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                    {tenant_filter}
                """),
                {"uid": normalized_use_case_id, "tid": tenant_id},
            )
            return {"message": "Relationship not found", "associated_count": int(cnt.scalar() or 0)}

        delete_result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.ai_use_case_business_processes
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
                  {tenant_filter}
            """),
            {"uid": normalized_use_case_id, "pid": normalized_process_id, "tid": tenant_id},
        )

        cnt = await db.execute(
            text(f"""
                SELECT COUNT(DISTINCT business_process_id)
                FROM {CORE}.ai_use_case_business_processes
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                {tenant_filter}
            """),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        await db.commit()
        return {
            "message": "Relationship removed",
            "associated_count": int(cnt.scalar() or 0),
            "rows_deleted": int(delete_result.rowcount or 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

@router.get("/{use_case_id}/attachments", summary="List AI Use Case Attachments")
async def list_use_case_attachments(use_case_id: str, db: AsyncSession = Depends(get_db)):
    await _ensure_use_case_attachments_table(db)

    rows = await db.execute(
        text(
            """
            SELECT id, use_case_id, filename, mime_type, file_size_bytes, created_at, updated_at
            FROM public.use_case_attachment
            WHERE use_case_id = :use_case_id
            ORDER BY created_at DESC
            """
        ),
        {"use_case_id": use_case_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{use_case_id}/attachments", summary="Upload AI Use Case Attachment", status_code=201)
async def create_use_case_attachment(
    use_case_id: str,
    body: UseCaseAttachmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_use_case_attachments_table(db)

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
            INSERT INTO public.use_case_attachment
                (use_case_id, filename, mime_type, file_size_bytes, file_data)
            VALUES
                (:use_case_id, :filename, :mime_type, :file_size_bytes, :file_data)
            RETURNING id, use_case_id, filename, mime_type, file_size_bytes, created_at, updated_at
            """
        ),
        {
            "use_case_id": use_case_id,
            "filename": filename,
            "mime_type": mime_type,
            "file_size_bytes": len(file_data),
            "file_data": file_data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get("/{use_case_id}/attachments/{attachment_id}/download", summary="Download AI Use Case Attachment")
async def download_use_case_attachment(
    use_case_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_use_case_attachments_table(db)

    row = await db.execute(
        text(
            """
            SELECT filename, mime_type, file_data
            FROM public.use_case_attachment
            WHERE id = :attachment_id
              AND use_case_id = :use_case_id
            LIMIT 1
            """
        ),
        {"attachment_id": attachment_id, "use_case_id": use_case_id},
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


@router.delete("/{use_case_id}/attachments/{attachment_id}", summary="Delete AI Use Case Attachment")
async def delete_use_case_attachment(
    use_case_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _ensure_use_case_attachments_table(db)

    result = await db.execute(
        text(
            """
            DELETE FROM public.use_case_attachment
            WHERE id = :attachment_id
              AND use_case_id = :use_case_id
            """
        ),
        {"attachment_id": attachment_id, "use_case_id": use_case_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"status": "deleted", "attachment_id": attachment_id}