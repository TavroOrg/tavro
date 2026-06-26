import logging
import os
import uuid
import threading
from datetime import datetime, timezone
from typing import Literal, Optional, Dict, Any, List

logger = logging.getLogger(__name__)

import requests

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from utils.db import DATABASE_URL
from api.database import get_db

from temporalio.client import Client

from services.workflow.workflow import RiskManagerWorkflow

TASK_QUEUE = "risk-classification-queue"
TEMPORAL_ADDRESS = os.getenv("TEMPORAL_ADDRESS", "risk-temporal:7233")

router = APIRouter()

_WORKFLOW_STATUS_LOCK = threading.Lock()
_WORKFLOW_STATUS: Dict[str, Dict[str, Any]] = {}

# ============================================================
# DATABASE CONFIG
# ============================================================

CORE_DB_NAME = os.getenv("CORE_DB_NAME")
CURATED_DB_NAME = os.getenv("CURATED_DB_NAME")
RISK_MANAGEMENT_DB_NAME = os.getenv(
    "RISK_MANAGEMENT_DB_NAME",
    os.getenv("RISK_MANAGEMENT_DB_NAME")
)


async def execute_select(
    session: AsyncSession,
    query: str,
    params: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """Execute a SELECT query and return rows as dicts."""
    result = await session.execute(text(query), params or {})
    return [dict(row) for row in result.mappings().all()]


async def execute_dml(
    session: AsyncSession,
    query: str,
    params: Optional[Dict[str, Any]] = None
) -> int:
    """Execute an INSERT/UPDATE/DELETE and return rowcount."""
    result = await session.execute(text(query), params or {})
    await session.commit()
    return result.rowcount

# ============================================================
# EXISTING POST REQUEST / RESPONSE MODELS
# ============================================================

class RiskClassificationRequest(BaseModel):
    agent_internal_id: str = Field(..., min_length=1)
    agent_id: str = Field(..., min_length=1)
    agent_name: str = Field(..., min_length=1)
    agent_description: str = Field(..., min_length=1)
    agent_instructions: Optional[str] = Field(None, min_length=0)
    agent_role: Optional[str] = Field(None, min_length=0)
    provider: Optional[str] = Field(None, min_length=0)
    agent_platform: Optional[str] = Field(None, min_length=0)
    tenant_id: Optional[str] = Field(None, min_length=0)

    attack_vector_av: Literal["N", "A", "L", "P"] = "N"
    attack_complexity_ac: Literal["L", "H"] = "L"
    attack_requirements_at: Literal["P", "N"] = "P"
    privileges_required_pr: Literal["L", "N", "H"] = "L"
    user_interaction_ui: Literal["P", "N", "A"] = "P"
    vulnerable_system_confidentiality_vc: Literal["L", "H", "N"] = "L"
    vulnerable_system_integrity_vi: Literal["L", "H", "N"] = "L"
    vulnerable_system_availability_va: Literal["L", "H", "N"] = "L"
    subsequent_system_confidentiality_sc: Literal["L", "H", "N"] = "L"
    subsequent_system_integrity_si: Literal["L", "H", "N"] = "L"
    subsequent_system_availability_sa: Literal["L", "H", "N"] = "L"

    @field_validator("agent_internal_id", "agent_id", "agent_name", "agent_description")
    def check_no_whitespace(cls, v):
        if not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v


class RiskClassificationResponse(BaseModel):
    agent_internal_id: str
    agent_id: str
    risk_classification: str
    personally_identifiable_information: str
    protected_health_information: str
    payment_card_industry: str
    article_5: dict
    article_6: dict
    risk_rating_rationale: str


# ============================================================
# NEW REQUEST / RESPONSE MODELS
# ============================================================

class RiskSummaryResponse(BaseModel):
    agent_internal_id: str
    summary: Optional[str]


class UpdateRiskSummaryRequest(BaseModel):
    agent_internal_id: str = Field(..., min_length=1)

    @field_validator("agent_internal_id")
    def validate_agent_internal_id(cls, v):
        if not v.strip():
            raise ValueError("agent_internal_id cannot be empty")
        return v.strip()


class WorkflowStatusItem(BaseModel):
    workflow_id: str
    run_id: Optional[str] = None
    tenant_id: Optional[str] = None
    agent_internal_id: str
    agent_id: str
    agent_name: str
    agent_description: str
    status: str
    error: Optional[str] = None
    tenant_id: Optional[str] = None
    created_at: str
    updated_at: str


def _set_workflow_status(
    workflow_id: str,
    *,
    run_id: Optional[str],
    tenant_id: Optional[str],
    agent_internal_id: str,
    agent_id: str,
    agent_name: str,
    agent_description: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _WORKFLOW_STATUS_LOCK:
        prev = _WORKFLOW_STATUS.get(workflow_id)
        _WORKFLOW_STATUS[workflow_id] = {
            "workflow_id": workflow_id,
            "run_id": run_id or (prev.get("run_id") if prev else None),
            "agent_internal_id": agent_internal_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_description": agent_description,
            "status": status,
            "tenant_id": tenant_id if tenant_id is not None else (prev.get("tenant_id") if prev else None),
            "error": error,
            "created_at": prev.get("created_at", now) if prev else now,
            "updated_at": now,
        }


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    val = val.strip()
    return val or None

async def get_risk_summary(session: AsyncSession, agent_internal_id: str) -> Dict[str, Any]:

    query = f"""
        SELECT
            summary
        FROM {RISK_MANAGEMENT_DB_NAME}.agent_risk_assessment
        WHERE agent_internal_id = :iid
        ORDER BY updated_ts DESC
        LIMIT 1
    """

    rows = await execute_select(session, query, {"iid": agent_internal_id})

    if not rows:
        return {
            "error": "NOT_FOUND",
            "details": f"No risk summary found for '{agent_internal_id}'"
        }

    row = rows[0]

    return {
        "agent_internal_id": agent_internal_id,
        "summary": row.get("summary")
    }


async def delete_risk_summary(session: AsyncSession, agent_internal_id: str) -> Dict[str, Any]:

    queries = [

        f"""
        UPDATE {CORE_DB_NAME}.agent_risk_assessments
        SET summary = NULL
        WHERE agent_internal_id = :iid
        """,

        f"""
        UPDATE {CURATED_DB_NAME}.agent_360
        SET summary = NULL
        WHERE agent_internal_id = :iid
        """,

        f"""
        UPDATE {RISK_MANAGEMENT_DB_NAME}.agent_risk_assessment
        SET summary = NULL,
            updated_ts = NOW()
        WHERE agent_internal_id = :iid
        """
    ]

    for query in queries:
        await execute_dml(session, query, {"iid": agent_internal_id})

    return {
        "message": "Risk summary cleared successfully (records retained).",
        "agent_internal_id": agent_internal_id
    }


def build_risk_payload(
    *,
    agent_internal_id: str,
    agent_id: str,
    agent_name: str,
    agent_description: str,
    agent_instructions: Optional[str],
    source_system: str,
    tenant_id: Optional[str]
) -> Dict[str, Any]:

    return {
        "agent_internal_id": agent_internal_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_description": agent_description,
        "agent_instructions": agent_instructions or "",
        "agent_role": "",
        "provider": source_system,
        "agent_platform": "",
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
        "tenant_id": tenant_id
    }


def send_payload_async(payload: Dict[str, Any]) -> None:

    def _send():
        try:
            requests.post(
                "http://tavro-api:8000/api/v1/risk/classify-risk",
                json=payload,
                timeout=5
            )
        except Exception as e:
            logger.warning("Risk assessment trigger failed: %s", e)

    threading.Thread(target=_send, daemon=True).start()


async def update_risk_summary(session: AsyncSession, agent_internal_id: str) -> Dict[str, Any]:

    query = f"""
        SELECT
            a.agent_internal_id,
            a.agent_id,
            a.agent_name,
            a.agent_description,
            a.source_system,
            a.tenant_id,
            i.instruction
        FROM {CORE_DB_NAME}.agents a
        LEFT JOIN {CORE_DB_NAME}.agent_identifications i
            ON a.agent_internal_id = i.agent_internal_id
            AND a.agent_id = i.agent_id
            AND i.is_current = true
        WHERE a.agent_internal_id = :iid
          AND a.is_current = true
        ORDER BY a.updated_ts DESC
        LIMIT 1
    """

    rows = await execute_select(session, query, {"iid": agent_internal_id})

    if not rows:
        return {
            "error": "NOT_FOUND",
            "details": f"No agent found with internal id '{agent_internal_id}'"
        }

    row = rows[0]

    payload = build_risk_payload(
        agent_internal_id=row.get("agent_internal_id"),
        agent_id=row.get("agent_id"),
        agent_name=row.get("agent_name"),
        agent_description=row.get("agent_description"),
        agent_instructions=row.get("instruction") or "",
        source_system=row.get("source_system") or "",
        tenant_id=row.get("tenant_id")
    )

    send_payload_async(payload)

    return {
        "message": "Risk assessment update triggered successfully.",
        "agent_internal_id": row.get("agent_internal_id"),
        "agent_id": row.get("agent_id")
    }


# ============================================================
# EXISTING POST API
# ============================================================

async def _track_workflow(
    workflow_id: str,
    handle: Any,
    tenant_id: Optional[str],
    agent_internal_id: str,
    agent_id: str,
    agent_name: str,
    agent_description: str,
) -> None:
    try:
        await handle.result()
        _set_workflow_status(
            workflow_id,
            run_id=handle.result_run_id,
            tenant_id=tenant_id,
            agent_internal_id=agent_internal_id,
            agent_id=agent_id,
            agent_name=agent_name,
            agent_description=agent_description,
            status="completed",
        )
    except Exception as e:
        _set_workflow_status(
            workflow_id,
            run_id=handle.result_run_id,
            tenant_id=tenant_id,
            agent_internal_id=agent_internal_id,
            agent_id=agent_id,
            agent_name=agent_name,
            agent_description=agent_description,
            status="failed",
            error=str(e),
        )


@router.post("/classify-risk", status_code=202)
async def classify_risk(
    request: RiskClassificationRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
):
    workflow_id = f"risk-manager-{uuid.uuid4()}"
    tenant_id = request.tenant_id or _tenant(http_request)
    _set_workflow_status(
        workflow_id,
        run_id=None,
        tenant_id=tenant_id,
        agent_internal_id=request.agent_internal_id,
        agent_id=request.agent_id,
        agent_name=request.agent_name,
        agent_description=request.agent_description,
        status="running",
    )

    try:
        client = await Client.connect(TEMPORAL_ADDRESS)
        handle = await client.start_workflow(
            RiskManagerWorkflow.run,
            args=[
                request.agent_internal_id,
                request.agent_id,
                request.agent_name,
                request.agent_description,
                request.agent_instructions,
                request.agent_role,
                request.provider,
                request.agent_platform,
                request.attack_vector_av,
                request.attack_complexity_ac,
                request.attack_requirements_at,
                request.privileges_required_pr,
                request.user_interaction_ui,
                request.vulnerable_system_confidentiality_vc,
                request.vulnerable_system_integrity_vi,
                request.vulnerable_system_availability_va,
                request.subsequent_system_confidentiality_sc,
                request.subsequent_system_integrity_si,
                request.subsequent_system_availability_sa,
                tenant_id,
            ],
            id=workflow_id,
            task_queue=TASK_QUEUE,
        )

        _set_workflow_status(
            workflow_id,
            run_id=handle.result_run_id,
            tenant_id=tenant_id,
            agent_internal_id=request.agent_internal_id,
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            agent_description=request.agent_description,
            status="running",
        )

        background_tasks.add_task(
            _track_workflow,
            workflow_id,
            handle,
            tenant_id,
            request.agent_internal_id,
            request.agent_id,
            request.agent_name,
            request.agent_description,
        )

        return {
            "workflow_id": workflow_id,
            "agent_id": request.agent_id,
            "agent_internal_id": request.agent_internal_id,
            "status": "running",
        }

    except Exception as e:
        _set_workflow_status(
            workflow_id,
            run_id=None,
            tenant_id=tenant_id,
            agent_internal_id=request.agent_internal_id,
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            agent_description=request.agent_description,
            status="failed",
            error=str(e),
        )
        raise


@router.get("/workflows", response_model=List[WorkflowStatusItem])
async def list_risk_workflows(request: Request, status: Optional[str] = None, agent_id: Optional[str] = None):
    tenant_id = _tenant(request)
    logger.debug("TENANT_ID: %s", tenant_id)
    with _WORKFLOW_STATUS_LOCK:
        rows = list(_WORKFLOW_STATUS.values())

    if tenant_id:
        rows = [r for r in rows if str(r.get("tenant_id") or "") == tenant_id]
    else:
        rows = [r for r in rows if not str(r.get("tenant_id") or "").strip()]

    if status:
        status_l = status.strip().lower()
        rows = [r for r in rows if str(r.get("status", "")).lower() == status_l]

    if agent_id:
        aid = agent_id.strip().lower()
        rows = [r for r in rows if str(r.get("agent_id", "")).lower() == aid or str(r.get("agent_internal_id", "")).lower() == aid]

    rows.sort(key=lambda r: r.get("updated_at", ""), reverse=True)
    return [WorkflowStatusItem(**r) for r in rows]


# ============================================================
# GET RISK SUMMARY API
# ============================================================

@router.get("/risk-summary/{agent_internal_id}", response_model=RiskSummaryResponse)
async def fetch_risk_summary(agent_internal_id: str, db: AsyncSession = Depends(get_db)):

    result = await get_risk_summary(db, agent_internal_id)

    if result.get("error"):
        raise HTTPException(
            status_code=404,
            detail=result.get("details")
        )

    return RiskSummaryResponse(
        agent_internal_id=result["agent_internal_id"],
        summary=result["summary"]
    )


# ============================================================
# UPDATE RISK SUMMARY API
# ============================================================

@router.put("/risk-summary")
async def refresh_risk_summary(
    request: UpdateRiskSummaryRequest,
    db: AsyncSession = Depends(get_db)
):

    result = await update_risk_summary(
        db, request.agent_internal_id
    )

    if result.get("error"):
        raise HTTPException(
            status_code=404,
            detail=result.get("details")
        )

    return JSONResponse(
        status_code=200,
        content=result
    )


# ============================================================
# DELETE RISK SUMMARY API
# ============================================================

@router.delete("/risk-summary/{agent_internal_id}")
async def remove_risk_summary(agent_internal_id: str, db: AsyncSession = Depends(get_db)):

    result = await delete_risk_summary(db, agent_internal_id)

    return JSONResponse(
        status_code=200,
        content=result
    )
