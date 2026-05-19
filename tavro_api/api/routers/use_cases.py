from __future__ import annotations

import os
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

CORE = os.getenv("CORE_GLUE_DB_NAME", "core")

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


# ---------------------------------------------------------------------------
# GET /  — list use cases
# ---------------------------------------------------------------------------

@router.get("/", summary="List AI Use Cases")
async def list_use_cases(
    request: Request,
    title: Optional[str] = None,
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
                    {where_sql}
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
                WHERE u.identifier = :uid
                ORDER BY u.updated_ts DESC NULLS LAST
                LIMIT 1
            """),
            {"uid": use_case_id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")

        agents_result = await db.execute(
            text(f"""
                SELECT DISTINCT rel.agent_id, ag.agent_name AS name, ai.environment
                FROM {CORE}.agent_ai_use_cases rel
                LEFT JOIN {CORE}.agents ag
                    ON ag.agent_id = rel.agent_id AND ag.is_current = true
                LEFT JOIN {CORE}.agent_identifications ai
                    ON ai.agent_internal_id = rel.agent_internal_id
                    AND COALESCE(ai.is_current, true) = true
                WHERE rel.identifier = :uid AND rel.agent_id IS NOT NULL
                ORDER BY name NULLS LAST
            """),
            {"uid": use_case_id},
        )
        linked_agents = [dict(r) for r in agents_result.mappings().all()]

        data = {**dict(row), "of_associated_agents": linked_agents}
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
