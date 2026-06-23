from __future__ import annotations
import json
import os
import base64
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()

CORE = os.getenv("CORE_DB_NAME", "core")
RISK_MANAGEMENT = os.getenv("RISK_MANAGEMENT_DB_NAME", "risk_management")

# Catalog columns that may be supplied on create/update (everything except the
# system-managed ones: tenant_id, ai_model_id, no_of_associated_agents,
# agent_internal_id, created_ts, updated_ts).
_AI_MODEL_EDITABLE_COLUMNS: List[str] = [
    # Identification & Accountability
    "model_name", "owner", "description", "department_executive",
    "business_functions", "vendor_or_inhouse", "provider", "status",
    "parent_model_id", "version_number",
    # ARE
    "business_criticality", "emergency_tier",
    # Intended Use & Decision Impact
    "use_case_value_drivers", "user_types", "decision_type", "automation_level",
    "regulatory_mapping", "consumer_impact", "risk_tier_materiality",
    # Model Construct
    "model_type", "technique_class", "learning_approach", "update_frequency",
    "input_variable_count", "data_join_method", "statistical_assumptions",
    "documented_constraints", "stability_window",
    # Model Validation
    "last_validation_date",
    # Model Recertification
    "recert_use_case_same", "recert_use_case_changed",
    "recert_inputs_same", "recert_inputs_changed",
    "recert_outputs_same", "recert_outputs_changed",
    "recert_users_same", "recert_users_changed",
    "recert_processing_same", "recert_processing_changed",
    "recert_training_completed", "recert_risk_assessment_done",
]


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


def _norm_id(value: str) -> str:
    return (value or "").strip()


async def _get_company_name(db: AsyncSession, company_id: str) -> Optional[str]:
    try:
        row = await db.execute(
            text("SELECT name FROM twin.company WHERE id = :cid LIMIT 1"),
            {"cid": company_id},
        )
        result = row.mappings().first()
        return result["name"] if result else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_name: Optional[str] = None
    owner: Optional[str] = None
    description: Optional[str] = None
    department_executive: Optional[str] = None
    business_functions: Optional[str] = None
    vendor_or_inhouse: Optional[str] = None
    provider: Optional[str] = None
    status: Optional[str] = None
    parent_model_id: Optional[str] = None
    version_number: Optional[str] = None
    use_case_value_drivers: Optional[str] = None
    user_types: Optional[str] = None
    decision_type: Optional[str] = None
    automation_level: Optional[str] = None
    regulatory_mapping: Optional[str] = None
    consumer_impact: Optional[str] = None
    risk_tier_materiality: Optional[str] = None
    model_type: Optional[str] = None
    technique_class: Optional[str] = None
    learning_approach: Optional[str] = None
    update_frequency: Optional[str] = None
    input_variable_count: Optional[str] = None
    data_join_method: Optional[str] = None
    statistical_assumptions: Optional[str] = None
    documented_constraints: Optional[str] = None
    stability_window: Optional[str] = None
    last_validation_date: Optional[str] = None
    recert_use_case_same: Optional[str] = None
    recert_use_case_changed: Optional[str] = None
    recert_inputs_same: Optional[str] = None
    recert_inputs_changed: Optional[str] = None
    recert_outputs_same: Optional[str] = None
    recert_outputs_changed: Optional[str] = None
    recert_users_same: Optional[str] = None
    recert_users_changed: Optional[str] = None
    recert_processing_same: Optional[str] = None
    recert_processing_changed: Optional[str] = None
    recert_training_completed: Optional[str] = None
    recert_risk_assessment_done: Optional[str] = None
    business_criticality: Optional[str] = None
    emergency_tier: Optional[str] = None


class AiModelCreate(AiModel):
    pass


class AiModelUpdate(AiModel):
    pass


class LinkAgentRequest(BaseModel):
    agent_id: str


class LinkUseCaseRequest(BaseModel):
    ai_use_case_id: str


class LinkApplicationRequest(BaseModel):
    business_application_id: str


class LinkProcessRequest(BaseModel):
    business_process_id: str


class AiModelAttachmentCreate(BaseModel):
    filename: str
    mime_type: str
    content_base64: str
    category: Optional[str] = None


class SuggestModelDescriptionRequest(BaseModel):
    model_name: str


class SuggestModelDescriptionResponse(BaseModel):
    description: str


SUGGEST_MODEL_DESCRIPTION_SYSTEM = """You are helping a user register an AI / ML model in Tavro.

Given only a model name, generate a short plain-text description of what the model likely does.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Be specific and practical, but do not invent vendors, versions, or implementation details.
- Focus on the model's likely purpose, the decisions it supports, and who uses it.
- Do not assume a specific technique (e.g., deep learning, LLM, gradient boosting) unless the name makes it explicit.
- If the name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence model description"
}"""


# ---------------------------------------------------------------------------
# POST /suggest-description
# ---------------------------------------------------------------------------

@router.post("/suggest-description", response_model=SuggestModelDescriptionResponse, summary="Suggest AI Model Description")
async def suggest_model_description(body: SuggestModelDescriptionRequest):
    model_name = body.model_name.strip()
    if not model_name:
        raise HTTPException(status_code=400, detail="model_name is required")

    provider, api_key = _resolve_agent_llm()
    user_prompt = f"""Generate a concise description for this AI/ML model:

Model name: {model_name}

Return ONLY the JSON object with the "description" field."""

    if provider == "openai":
        data = await _call_openai(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_MODEL_DESCRIPTION_SYSTEM,
            300,
        )
    else:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_MODEL_DESCRIPTION_SYSTEM,
            tools=None,
            max_tokens=300,
        )

    raw = _collect_text(data).strip()
    try:
        parsed = json.loads(_extract_json(raw))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return SuggestModelDescriptionResponse(description=str(parsed.get("description", "")).strip())


# ---------------------------------------------------------------------------
# GET /  — list AI models
# ---------------------------------------------------------------------------

@router.get("/", summary="List AI Models")
async def list_ai_models(
    request: Request,
    q: Optional[str] = None,
    start_record: int = 1,
    record_range: str = "1-500",
    company_id: Optional[str] = Query(None, description="Filter by company UUID"),
    tenant_id: Optional[str] = Query(None, description="Filter by tenant ID"),
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 499

    tenant_id = (tenant_id or "").strip() or _tenant(request)
    where_clauses: List[str] = ["m.ai_model_id IS NOT NULL", "m.ai_model_id <> ''"]
    params: Dict[str, Any] = {}
    if tenant_id:
        where_clauses.append(
            "m.tenant_id = :tid"
        )
        params["tid"] = tenant_id
    if company_id:
        where_clauses.append(
            "(m.company_id = :cid OR m.company_id IS NULL OR TRIM(CAST(m.company_id AS text)) = '' OR m.company_id = 'None')"
        )
        params["cid"] = company_id
    if q and q.strip():
        where_clauses.append(
            "(LOWER(m.model_name) LIKE LOWER(:q) OR LOWER(m.ai_model_id) LIKE LOWER(:q) OR LOWER(COALESCE(m.description,'')) LIKE LOWER(:q))"
        )
        params["q"] = f"%{q.strip()}%"
    where_sql = " AND ".join(where_clauses)

    rel_tenant_filter = (
        "AND rel.tenant_id = :tid"
        if tenant_id
        else ""
    )

    # Company filter for the agent count subquery — join agents table to apply company_id.
    _agent_cnt_join = f"JOIN {CORE}.agents ag ON ag.agent_id = rel.agent_id" if company_id else ""
    _agent_cnt_cf = (
        "AND (ag.company_id = :cid OR ag.company_id IS NULL"
        " OR TRIM(CAST(ag.company_id AS text)) = '' OR ag.company_id = 'None')"
        if company_id else ""
    )

    try:
        result = await db.execute(
            text(f"""
                SELECT *
                FROM (
                    SELECT
                        m.*,
                        COALESCE((
                            SELECT COUNT(DISTINCT rel.agent_id)
                            FROM {CORE}.agent_ai_models rel
                            {_agent_cnt_join}
                            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(m.ai_model_id))
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {rel_tenant_filter}
                              {_agent_cnt_cf}
                        ), 0) AS related_agent_count,
                        ROW_NUMBER() OVER (ORDER BY m.created_ts DESC NULLS LAST) AS rn,
                        COUNT(*) OVER () AS total_records
                    FROM {CORE}.ai_models m
                    WHERE {where_sql}
                ) t
                WHERE rn BETWEEN :start AND :end
            """),
            {**params, "start": start, "end": end},
        )
        rows = result.mappings().all()
        total = int(rows[0]["total_records"]) if rows else 0
        data = [{k: v for k, v in r.items() if k not in ("rn", "total_records")} for r in rows]
        return {"start_record": start, "end_record": end, "record_count": len(data),
                "total_records": total, "items": data, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /  — create AI model
# ---------------------------------------------------------------------------

@router.post("/", summary="Create AI Model", status_code=201)
async def create_ai_model(
    body: AiModelCreate,
    request: Request,
    company_id: Optional[str] = Query(None, description="Company UUID — stores company_id/company_name on the record"),
    db: AsyncSession = Depends(get_db),
):
    ai_model_id = str(uuid.uuid4())
    tenant_id = _tenant(request)
    company_name = await _get_company_name(db, company_id) if company_id else None

    payload = body.model_dump(exclude_none=True)
    columns = [
        "tenant_id", "ai_model_id", "no_of_associated_agents", "blended_risk_score",
        "agent_risk_exposure", "agent_risk_tier", "inherent_risk_classification",
        "residual_risk_classification", "inherent_risk_classification_score",
        "residual_risk_classification_score", "created_ts", "updated_ts",
    ]
    placeholders = [
        ":tid", ":mid", "0", "0", "0", "'None'", "'None'",
        "'None'", "0", "0", "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP",
    ]
    params: Dict[str, Any] = {"tid": tenant_id, "mid": ai_model_id}
    if company_id:
        columns += ["company_id", "company_name"]
        placeholders += [":cid", ":cname"]
        params["cid"] = company_id
        params["cname"] = company_name
    for col in _AI_MODEL_EDITABLE_COLUMNS:
        if col in payload:
            columns.append(col)
            placeholders.append(f":{col}")
            params[col] = payload[col]

    try:
        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_models ({", ".join(columns)})
                VALUES ({", ".join(placeholders)})
            """),
            params,
        )
        await db.commit()
        return {"message": "AI Model registered successfully.", "ai_model_id": ai_model_id}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# GET /{ai_model_id}  — get single model + linked agents
# ---------------------------------------------------------------------------

@router.get("/{ai_model_id}", summary="Get AI Model")
async def get_ai_model(
    ai_model_id: str,
    request: Request,
    company_id: Optional[str] = Query(default=None, description="Filter related items by company"),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _tenant(request)
    mid = _norm_id(ai_model_id)
    tenant_filter = "AND m.tenant_id = :tid" if tenant_id else ""
    row = await db.execute(
        text(f"""
            SELECT m.* FROM {CORE}.ai_models m
            WHERE LOWER(TRIM(m.ai_model_id)) = LOWER(TRIM(:mid))
              {tenant_filter}
            LIMIT 1
        """),
        {"mid": mid, "tid": tenant_id},
    )
    model = row.mappings().first()
    if not model:
        raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

    _company_inclusive = (
        " OR {col}.company_id IS NULL"
        " OR TRIM(CAST({col}.company_id AS text)) = ''"
        " OR {col}.company_id = 'None'"
    )
    def _company_filter(col: str) -> str:
        if not company_id:
            return ""
        return f"AND ({col}.company_id = :company_id{_company_inclusive.format(col=col)})"

    def _tf(col: str) -> str:
        if not tenant_id:
            return ""
        return f"AND {col}.tenant_id = :tid"

    rel_params: dict[str, Any] = {"mid": mid}
    if company_id:
        rel_params["company_id"] = company_id
    if tenant_id:
        rel_params["tid"] = tenant_id

    agent_rows = await db.execute(
        text(f"""
            SELECT
                rel.agent_id,
                rel.agent_internal_id,
                COALESCE(a.agent_name, rel.agent_name, rel.agent_id) AS agent_name
            FROM {CORE}.agent_ai_models rel
            LEFT JOIN {CORE}.agents a
                ON a.agent_internal_id = rel.agent_internal_id
                AND COALESCE(a.is_current, true) = true
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND rel.agent_id IS NOT NULL AND rel.agent_id <> ''
              {_tf('rel')}
              {_company_filter('a')}
              {_tf('a')}
            ORDER BY LOWER(COALESCE(a.agent_name, rel.agent_name, rel.agent_id))
        """),
        rel_params,
    )
    use_case_rows = await db.execute(
        text(f"""
            SELECT
                rel.ai_use_case_id,
                COALESCE(uc.name, rel.ai_use_case_name, rel.ai_use_case_id) AS ai_use_case_name,
                uc.description,
                uc.owner,
                uc.priority,
                uc.status
            FROM {CORE}.ai_model_ai_use_cases rel
            LEFT JOIN {CORE}.ai_use_cases uc
                ON LOWER(TRIM(uc.ai_use_case_id)) = LOWER(TRIM(rel.ai_use_case_id))
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND rel.ai_use_case_id IS NOT NULL AND rel.ai_use_case_id <> ''
              {_tf('rel')}
              {_company_filter('uc')}
              {_tf('uc')}
            ORDER BY LOWER(COALESCE(uc.name, rel.ai_use_case_name, rel.ai_use_case_id))
        """),
        rel_params,
    )

    application_rows = await db.execute(
        text(f"""
            SELECT
                rel.business_application_id,
                COALESCE(ba.application_name, rel.application_name, rel.business_application_id) AS application_name,
                ba.application_description AS description,
                ba.business_criticality,
                ba.emergency_tier
            FROM {CORE}.ai_model_business_applications rel
            LEFT JOIN {CORE}.business_applications ba
                ON LOWER(TRIM(ba.business_application_id)) = LOWER(TRIM(rel.business_application_id))
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND rel.business_application_id IS NOT NULL AND rel.business_application_id <> ''
              {_tf('rel')}
              {_company_filter('ba')}
              {_tf('ba')}
            ORDER BY LOWER(COALESCE(ba.application_name, rel.application_name, rel.business_application_id))
        """),
        rel_params,
    )
    process_rows = await db.execute(
        text(f"""
            SELECT
                rel.business_process_id,
                COALESCE(bp.process_name, rel.process_name, rel.business_process_id) AS process_name,
                bp.process_description AS description,
                bp.business_criticality
            FROM {CORE}.ai_model_business_processes rel
            LEFT JOIN {CORE}.business_processes bp
                ON LOWER(TRIM(bp.business_process_id)) = LOWER(TRIM(rel.business_process_id))
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND rel.business_process_id IS NOT NULL AND rel.business_process_id <> ''
              {_tf('rel')}
              {_company_filter('bp')}
              {_tf('bp')}
            ORDER BY LOWER(COALESCE(bp.process_name, rel.process_name, rel.business_process_id))
        """),
        rel_params,
    )

    result = dict(model)
    result["agents"] = [dict(r._mapping) for r in agent_rows]
    result["ai_use_cases"] = [dict(r._mapping) for r in use_case_rows]
    result["applications"] = [dict(r._mapping) for r in application_rows]
    result["processes"] = [dict(r._mapping) for r in process_rows]
    return result


# ---------------------------------------------------------------------------
# PUT /{ai_model_id}  — update AI model
# ---------------------------------------------------------------------------

@router.put("/{ai_model_id}", summary="Update AI Model")
async def update_ai_model(
    ai_model_id: str,
    body: AiModelUpdate,
    company_id: Optional[str] = Query(None, description="Company UUID — updates company_id/company_name on the record"),
    db: AsyncSession = Depends(get_db),
):
    mid = _norm_id(ai_model_id)
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.ai_models WHERE ai_model_id = :mid LIMIT 1"),
            {"mid": mid},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        company_name = await _get_company_name(db, company_id) if company_id else None
        payload = body.model_dump(exclude_none=True)
        sets: List[str] = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"mid": mid}
        if company_id:
            sets += ["company_id = :cid", "company_name = :cname"]
            params["cid"] = company_id
            params["cname"] = company_name
        for col in _AI_MODEL_EDITABLE_COLUMNS:
            if col in payload:
                sets.append(f"{col} = :{col}")
                params[col] = payload[col]

        await db.execute(
            text(f"UPDATE {CORE}.ai_models SET {', '.join(sets)} WHERE ai_model_id = :mid"),
            params,
        )
        await db.commit()
        if {"business_criticality", "emergency_tier"} & set(payload.keys()):
            await _refresh_model_rollup(db, mid)
            await db.commit()
        return {"message": "AI Model updated successfully.", "ai_model_id": mid}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{ai_model_id}
# ---------------------------------------------------------------------------

@router.delete("/{ai_model_id}", summary="Delete AI Model")
async def delete_ai_model(ai_model_id: str, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.ai_models WHERE ai_model_id = :mid LIMIT 1"),
            {"mid": mid},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        await db.execute(
            text("DELETE FROM public.ai_model_attachment WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.agent_ai_models WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_model_ai_use_cases WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_model_business_applications WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_model_business_processes WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_models WHERE ai_model_id = :mid"),
            {"mid": mid},
        )
        await db.commit()
        return {"message": "AI Model deleted successfully.", "ai_model_id": mid}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{ai_model_id}/agents  — link agent
# ---------------------------------------------------------------------------

@router.post("/{ai_model_id}/agents", summary="Link Agent to AI Model")
async def link_agent(ai_model_id: str, body: LinkAgentRequest, request: Request, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    agent_id = body.agent_id
    tenant_id = _tenant(request)
    try:
        model_row = await db.execute(
            text(f"SELECT ai_model_id, model_name, company_id FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
            {"mid": mid},
        )
        model = model_row.mappings().first()
        if not model:
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        agent_row = await db.execute(
            text(f"SELECT agent_internal_id, agent_name FROM {CORE}.agents WHERE agent_id = :aid AND is_current = true LIMIT 1"),
            {"aid": agent_id},
        )
        agent = agent_row.mappings().first()
        if not agent:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        agent_internal_id = str(agent["agent_internal_id"])
        agent_name = str(agent.get("agent_name") or "")

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.agent_ai_models
                    (tenant_id, company_id, ai_model_id, model_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts)
                VALUES
                    (:tid, :cid, :mid, :mname, :aid, :aname, :iid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (agent_internal_id, ai_model_id)
                DO UPDATE SET
                    model_name = EXCLUDED.model_name,
                    agent_id = EXCLUDED.agent_id,
                    agent_name = EXCLUDED.agent_name,
                    tenant_id = EXCLUDED.tenant_id,
                    updated_ts = EXCLUDED.updated_ts
            """),
            {
                "tid": tenant_id,
                "cid": model.get("company_id"),
                "mid": mid,
                "mname": str(model.get("model_name") or mid),
                "aid": agent_id,
                "aname": agent_name,
                "iid": agent_internal_id,
            },
        )
        await _refresh_model_rollup(db, mid)
        await db.commit()
        return {"status": "linked", "ai_model_id": mid, "agent_id": agent_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{ai_model_id}/agents/{agent_id}  — unlink agent
# ---------------------------------------------------------------------------

@router.delete("/{ai_model_id}/agents/{agent_id}", summary="Unlink Agent from AI Model")
async def unlink_agent(ai_model_id: str, agent_id: str, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    try:
        result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.agent_ai_models
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  AND agent_id = :aid
            """),
            {"mid": mid, "aid": agent_id},
        )
        await _refresh_model_rollup(db, mid)
        await db.commit()
        return {"status": "unlinked", "ai_model_id": mid, "agent_id": agent_id, "rows_deleted": result.rowcount or 0}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{ai_model_id}/use-cases  — link AI use case (many-to-many)
# ---------------------------------------------------------------------------

@router.post("/{ai_model_id}/use-cases", summary="Link AI Use Case to AI Model")
async def link_use_case(ai_model_id: str, body: LinkUseCaseRequest, request: Request, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    uc_id = _norm_id(body.ai_use_case_id)
    tenant_id = _tenant(request)
    if not uc_id:
        raise HTTPException(status_code=400, detail="ai_use_case_id is required.")
    try:
        model_row = await db.execute(
            text(f"SELECT ai_model_id, model_name, company_id FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
            {"mid": mid},
        )
        model = model_row.mappings().first()
        if not model:
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        uc_row = await db.execute(
            text(f"SELECT ai_use_case_id, name FROM {CORE}.ai_use_cases WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid)) LIMIT 1"),
            {"uid": uc_id},
        )
        use_case = uc_row.mappings().first()
        if not use_case:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{uc_id}' not found.")

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_model_ai_use_cases
                    (tenant_id, company_id, ai_model_id, ai_model_name, ai_use_case_id, ai_use_case_name, created_ts, updated_ts)
                VALUES
                    (:tid, :cid, :mid, :mname, :uid, :uname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (ai_model_id, ai_use_case_id)
                DO UPDATE SET
                    ai_model_name = EXCLUDED.ai_model_name,
                    ai_use_case_name = EXCLUDED.ai_use_case_name,
                    tenant_id = EXCLUDED.tenant_id,
                    updated_ts = EXCLUDED.updated_ts
            """),
            {
                "tid": tenant_id,
                "cid": model.get("company_id"),
                "mid": mid,
                "mname": str(model.get("model_name") or mid),
                "uid": uc_id,
                "uname": str(use_case.get("name") or uc_id),
            },
        )
        await db.commit()
        return {"status": "linked", "ai_model_id": mid, "ai_use_case_id": uc_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /{ai_model_id}/use-cases/{use_case_id}  — unlink AI use case
# ---------------------------------------------------------------------------

@router.delete("/{ai_model_id}/use-cases/{use_case_id}", summary="Unlink AI Use Case from AI Model")
async def unlink_use_case(ai_model_id: str, use_case_id: str, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    uc_id = _norm_id(use_case_id)
    try:
        result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.ai_model_ai_use_cases
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  AND LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
            """),
            {"mid": mid, "uid": uc_id},
        )
        await db.commit()
        return {"status": "unlinked", "ai_model_id": mid, "ai_use_case_id": uc_id, "rows_deleted": result.rowcount or 0}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST/DELETE /{ai_model_id}/applications  — link/unlink business application
# ---------------------------------------------------------------------------

@router.post("/{ai_model_id}/applications", summary="Link Application to AI Model")
async def link_application(ai_model_id: str, body: LinkApplicationRequest, request: Request, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    app_id = _norm_id(body.business_application_id)
    tenant_id = _tenant(request)
    if not app_id:
        raise HTTPException(status_code=400, detail="business_application_id is required.")
    try:
        model_row = await db.execute(
            text(f"SELECT ai_model_id, model_name, company_id FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
            {"mid": mid},
        )
        model = model_row.mappings().first()
        if not model:
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        app_row = await db.execute(
            text(f"SELECT business_application_id, application_name FROM {CORE}.business_applications WHERE LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid)) LIMIT 1"),
            {"aid": app_id},
        )
        application = app_row.mappings().first()
        if not application:
            raise HTTPException(status_code=404, detail=f"Application '{app_id}' not found.")

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_model_business_applications
                    (tenant_id, company_id, ai_model_id, ai_model_name, business_application_id, application_name, created_ts, updated_ts)
                VALUES
                    (:tid, :cid, :mid, :mname, :aid, :aname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (ai_model_id, business_application_id)
                DO UPDATE SET
                    ai_model_name = EXCLUDED.ai_model_name,
                    application_name = EXCLUDED.application_name,
                    tenant_id = EXCLUDED.tenant_id,
                    updated_ts = EXCLUDED.updated_ts
            """),
            {
                "tid": tenant_id,
                "cid": model.get("company_id"),
                "mid": mid,
                "mname": str(model.get("model_name") or mid),
                "aid": app_id,
                "aname": str(application.get("application_name") or app_id),
            },
        )
        await db.commit()
        return {"status": "linked", "ai_model_id": mid, "business_application_id": app_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{ai_model_id}/applications/{application_id}", summary="Unlink Application from AI Model")
async def unlink_application(ai_model_id: str, application_id: str, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    app_id = _norm_id(application_id)
    try:
        result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.ai_model_business_applications
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
            """),
            {"mid": mid, "aid": app_id},
        )
        await db.commit()
        return {"status": "unlinked", "ai_model_id": mid, "business_application_id": app_id, "rows_deleted": result.rowcount or 0}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST/DELETE /{ai_model_id}/processes  — link/unlink business process
# ---------------------------------------------------------------------------

@router.post("/{ai_model_id}/processes", summary="Link Process to AI Model")
async def link_process(ai_model_id: str, body: LinkProcessRequest, request: Request, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    proc_id = _norm_id(body.business_process_id)
    tenant_id = _tenant(request)
    if not proc_id:
        raise HTTPException(status_code=400, detail="business_process_id is required.")
    try:
        model_row = await db.execute(
            text(f"SELECT ai_model_id, model_name, company_id FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
            {"mid": mid},
        )
        model = model_row.mappings().first()
        if not model:
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        proc_row = await db.execute(
            text(f"SELECT business_process_id, process_name FROM {CORE}.business_processes WHERE LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid)) LIMIT 1"),
            {"pid": proc_id},
        )
        process = proc_row.mappings().first()
        if not process:
            raise HTTPException(status_code=404, detail=f"Process '{proc_id}' not found.")

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_model_business_processes
                    (tenant_id, company_id, ai_model_id, ai_model_name, business_process_id, process_name, created_ts, updated_ts)
                VALUES
                    (:tid, :cid, :mid, :mname, :pid, :pname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (ai_model_id, business_process_id)
                DO UPDATE SET
                    ai_model_name = EXCLUDED.ai_model_name,
                    process_name = EXCLUDED.process_name,
                    tenant_id = EXCLUDED.tenant_id,
                    updated_ts = EXCLUDED.updated_ts
            """),
            {
                "tid": tenant_id,
                "cid": model.get("company_id"),
                "mid": mid,
                "mname": str(model.get("model_name") or mid),
                "pid": proc_id,
                "pname": str(process.get("process_name") or proc_id),
            },
        )
        await db.commit()
        return {"status": "linked", "ai_model_id": mid, "business_process_id": proc_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{ai_model_id}/processes/{process_id}", summary="Unlink Process from AI Model")
async def unlink_process(ai_model_id: str, process_id: str, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    proc_id = _norm_id(process_id)
    try:
        result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.ai_model_business_processes
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  AND LOWER(TRIM(business_process_id)) = LOWER(TRIM(:pid))
            """),
            {"mid": mid, "pid": proc_id},
        )
        await db.commit()
        return {"status": "unlinked", "ai_model_id": mid, "business_process_id": proc_id, "rows_deleted": result.rowcount or 0}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


async def _refresh_model_rollup(db: AsyncSession, ai_model_id: str) -> None:
    await db.execute(
        text(f"""
            UPDATE {CORE}.ai_models
            SET no_of_associated_agents = (
                SELECT COUNT(DISTINCT rel.agent_id)
                FROM {CORE}.agent_ai_models rel
                WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
                  AND rel.agent_id IS NOT NULL AND rel.agent_id <> ''
            ),
            updated_ts = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
        """),
        {"mid": ai_model_id},
    )

    ara_exists = (await db.execute(
        text("SELECT to_regclass(:t)"), {"t": f"{CORE}.agent_risk_assessments"}
    )).scalar()
    if not ara_exists:
        return

    model_row = await db.execute(
        text(f"SELECT business_criticality, emergency_tier FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
        {"mid": ai_model_id},
    )
    model = model_row.mappings().first()
    if not model:
        return

    bc = (model.get("business_criticality") or "").strip().lower()
    bc_score = {"high": 1.0, "medium": 0.4, "low": 0.1}.get(bc, 0.0)

    et = (model.get("emergency_tier") or "").strip().lower()
    et_score = {"mission critical": 1.0, "business critical": 0.4,
                "non-critical": 0.1, "non critical": 0.1}.get(et, 0.0)

    max_brs_row = await db.execute(
        text(f"""
            SELECT brs.agent_internal_id, brs.blended_risk_score
            FROM {CORE}.agent_ai_models rel
            JOIN LATERAL (
                SELECT ara.agent_internal_id, ara.blended_risk_score
                FROM {CORE}.agent_risk_assessments ara
                WHERE ara.agent_id = rel.agent_id
                  AND ara.blended_risk_score IS NOT NULL
                ORDER BY
                    CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                    ara.assessment_ts DESC NULLS LAST,
                    ara.updated_ts DESC NULLS LAST
                LIMIT 1
            ) brs ON TRUE
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND rel.agent_id IS NOT NULL AND rel.agent_id <> ''
            ORDER BY brs.blended_risk_score DESC NULLS LAST
            LIMIT 1
        """),
        {"mid": ai_model_id},
    )
    worst_row = max_brs_row.mappings().first()
    max_brs = float(worst_row.get("blended_risk_score") or 0.0) if worst_row else 0.0
    worst_internal_id = worst_row.get("agent_internal_id") if worst_row else None

    inherent_class = ""
    inherent_score = 0.0
    residual_class = ""
    residual_score = 0.0
    if worst_internal_id:
        rc_rows = await db.execute(
            text(f"""
                SELECT type_of_risk, risk_classification, risk_classification_score
                FROM {RISK_MANAGEMENT}.agent_risk_assessment
                WHERE agent_internal_id = :aid
                  AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                ORDER BY created_ts DESC NULLS LAST
            """),
            {"aid": worst_internal_id},
        )
        for rc_row in rc_rows.mappings():
            tor = rc_row.get("type_of_risk")
            if tor == "Inherent Risk" and not inherent_class:
                inherent_class = rc_row.get("risk_classification") or ""
                inherent_score = float(rc_row.get("risk_classification_score") or 0.0)
            elif tor == "Residual Risk" and not residual_class:
                residual_class = rc_row.get("risk_classification") or ""
                residual_score = float(rc_row.get("risk_classification_score") or 0.0)

    are = round(max_brs * (bc_score + et_score) / 2.0, 2)
    if are >= 9.0:
        art = "Critical"
    elif are >= 7.0:
        art = "High"
    elif are >= 3.0:
        art = "Medium"
    else:
        art = "Low"

    await db.execute(
        text(f"""
            UPDATE {CORE}.ai_models
            SET blended_risk_score = :max_brs,
                agent_risk_exposure = :are,
                agent_risk_tier = :art,
                inherent_risk_classification = :inherent_class,
                residual_risk_classification = :residual_class,
                inherent_risk_classification_score = :inherent_score,
                residual_risk_classification_score = :residual_score
            WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
        """),
        {
            "max_brs": max_brs, "are": are, "art": art, "mid": ai_model_id,
            "inherent_class": inherent_class, "inherent_score": inherent_score,
            "residual_class": residual_class, "residual_score": residual_score,
        },
    )


# ---------------------------------------------------------------------------
# Attachments (per model, per category)
# ---------------------------------------------------------------------------

@router.get("/{ai_model_id}/attachments", summary="List AI Model Attachments")
async def list_model_attachments(ai_model_id: str, category: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    clauses = ["ai_model_id = :mid"]
    params: Dict[str, Any] = {"mid": ai_model_id}
    if category is not None:
        clauses.append("category = :category")
        params["category"] = category
    rows = await db.execute(
        text(f"""
            SELECT id, ai_model_id, category, filename, mime_type, file_size_bytes, created_at, updated_at
            FROM public.ai_model_attachment
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{ai_model_id}/attachments", summary="Upload AI Model Attachment", status_code=201)
async def create_model_attachment(ai_model_id: str, body: AiModelAttachmentCreate, db: AsyncSession = Depends(get_db)):
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
            INSERT INTO public.ai_model_attachment
                (ai_model_id, category, filename, mime_type, file_size_bytes, file_data)
            VALUES
                (:ai_model_id, :category, :filename, :mime_type, :file_size_bytes, :file_data)
            RETURNING id, ai_model_id, category, filename, mime_type, file_size_bytes, created_at, updated_at
            """
        ),
        {
            "ai_model_id": ai_model_id,
            "category": (body.category or "").strip() or None,
            "filename": filename,
            "mime_type": mime_type,
            "file_size_bytes": len(file_data),
            "file_data": file_data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get("/{ai_model_id}/attachments/{attachment_id}/download", summary="Download AI Model Attachment")
async def download_model_attachment(ai_model_id: str, attachment_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text(
            """
            SELECT filename, mime_type, file_data
            FROM public.ai_model_attachment
            WHERE id = :attachment_id AND ai_model_id = :ai_model_id
            LIMIT 1
            """
        ),
        {"attachment_id": attachment_id, "ai_model_id": ai_model_id},
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


@router.delete("/{ai_model_id}/attachments/{attachment_id}", summary="Delete AI Model Attachment")
async def delete_model_attachment(ai_model_id: str, attachment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            """
            DELETE FROM public.ai_model_attachment
            WHERE id = :attachment_id AND ai_model_id = :ai_model_id
            """
        ),
        {"attachment_id": attachment_id, "ai_model_id": ai_model_id},
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.commit()
    return {"status": "deleted", "attachment_id": attachment_id}
