from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

CORE    = os.getenv("CORE_GLUE_DB_NAME",       "core")
CURATED = os.getenv("CURATED_GLUE_DB_NAME",    "curated")
RISK    = os.getenv("RISK_MANAGEMENT_DB_NAME",  os.getenv("RISK_MANAGEMENT_GLUE_DB_NAME", "risk_management"))
_RISK_URL = os.getenv("RISK_CLASSIFY_URL", "http://localhost:8000/api/v1/risk/classify-risk")


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


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
    agent_name: str
    description: str
    instruction: str
    tools: Optional[List[Dict[str, str]]] = None
    knowledge_source: Optional[Dict[str, str]] = None


class AgentUpdateRequest(BaseModel):
    agent_name: Optional[str] = None
    description: Optional[str] = None
    instruction: Optional[str] = None


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

    tenant_id = _tenant(request)
    where = ""
    params: Dict[str, Any] = {"start": start, "end": end}
    if tenant_id:
        where = "WHERE (tenant_id = :tid OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
        params["tid"] = tenant_id

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
    tenant_id = _tenant(request)

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
                     governance_status, created_ts, updated_ts, is_current)
                VALUES
                    (:tid, :iid, :aid, :instruction,
                     'Risk Assessment is running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
            """),
            {"tid": tenant_id, "iid": agent_internal_id, "aid": agent_id,
             "instruction": body.instruction},
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

        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    background_tasks.add_task(
        _fire_risk,
        _risk_payload(agent_internal_id, agent_id, body.agent_name,
                      body.description, body.instruction, tenant_id),
    )

    return {"agent_id": agent_id, "agent_name": body.agent_name,
            "message": "Agent created successfully and risk assessment triggered."}


# ---------------------------------------------------------------------------
# GET /{agent_id}  — agent card
# ---------------------------------------------------------------------------

@router.get("/{agent_id}", summary="Get Agent Card")
async def get_agent_card(agent_id: str, request: Request, db: AsyncSession = Depends(get_db)):
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
                    SELECT risk_classification, blended_risk_score, pii_flag, phi_flag, pci_flag
                    FROM {CORE}.agent_risk_assessments
                    WHERE agent_internal_id = a.agent_internal_id
                      AND COALESCE(is_current, true) = true
                    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
                    LIMIT 1
                ) r ON true
                WHERE a.agent_id = :aid AND a.is_current = true
                LIMIT 1
            """),
            {"aid": agent_id},
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
                WHERE a.agent_id = :aid AND a.is_current = true
                LIMIT 1
            """),
            {"aid": agent_id},
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
            str(row["instruction"] or ""), _tenant(request),
        ),
    )
    return {"message": "Risk assessment triggered.", "agent_id": agent_id,
            "agent_internal_id": str(row["agent_internal_id"])}


# ---------------------------------------------------------------------------
# PUT /{agent_id}  — update agent
# ---------------------------------------------------------------------------

@router.put("/{agent_id}", summary="Update Agent")
async def update_agent(agent_id: str, body: AgentUpdateRequest, db: AsyncSession = Depends(get_db)):
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.agents WHERE agent_id = :aid LIMIT 1"),
            {"aid": agent_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

        agent_sets = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"aid": agent_id}

        if body.agent_name and body.agent_name.strip():
            agent_sets.append("agent_name = :name")
            params["name"] = body.agent_name.strip()
        if body.description and body.description.strip():
            agent_sets.append("agent_description = :desc")
            params["desc"] = body.description.strip()

        if len(agent_sets) > 1:
            await db.execute(
                text(f"UPDATE {CORE}.agents SET {', '.join(agent_sets)} WHERE agent_id = :aid"),
                params,
            )

        if body.instruction is not None and body.instruction.strip():
            await db.execute(
                text(f"""
                    UPDATE {CORE}.agent_identifications
                    SET instruction = :instr, updated_ts = CURRENT_TIMESTAMP
                    WHERE agent_id = :aid AND COALESCE(is_current, true) = true
                """),
                {"instr": body.instruction.strip(), "aid": agent_id},
            )

        # Keep curated snapshot in sync so catalog refresh reflects changes immediately
        curated_sets: List[str] = []
        curated_params: Dict[str, Any] = {"aid": agent_id}
        if body.agent_name and body.agent_name.strip():
            curated_sets.append("agent_name = :c_name")
            curated_params["c_name"] = body.agent_name.strip()
        if body.description and body.description.strip():
            curated_sets.append("agent_description = :c_desc")
            curated_params["c_desc"] = body.description.strip()
        if curated_sets:
            await db.execute(
                text(f"UPDATE {CURATED}.agent_360 SET {', '.join(curated_sets)} WHERE agent_id = :aid"),
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
async def delete_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        row = await db.execute(
            text(f"SELECT agent_internal_id FROM {CORE}.agents WHERE agent_id = :aid LIMIT 1"),
            {"aid": agent_id},
        )
        mapping = row.mappings().first()
        if not mapping:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        internal_id = str(mapping["agent_internal_id"])

        await db.execute(
            text(f"""
                UPDATE {CORE}.agent_ai_use_cases
                SET agent_id = NULL, agent_internal_id = NULL,
                    no_of_associated_agents = GREATEST(COALESCE(no_of_associated_agents, 1) - 1, 0)
                WHERE agent_id = :aid
            """),
            {"aid": agent_id},
        )

        for table in ("agent_tools", "agent_knowledge_sources", "agent_data_sources", "agent_identifications"):
            await db.execute(
                text(f"DELETE FROM {CORE}.{table} WHERE agent_id = :aid"),
                {"aid": agent_id},
            )

        await db.execute(
            text(f"DELETE FROM {CORE}.agent_risk_assessments WHERE agent_internal_id = :iid"),
            {"iid": internal_id},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.agents WHERE agent_id = :aid"),
            {"aid": agent_id},
        )

        for schema_table in (f"{CURATED}.agent_360", f"{RISK}.agent_risk_assessment"):
            try:
                sp = await db.begin_nested()
                await db.execute(
                    text(f"DELETE FROM {schema_table} WHERE agent_internal_id = :iid"),
                    {"iid": internal_id},
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
