from __future__ import annotations
import json
import logging
import os
import base64
import uuid

_logger = logging.getLogger(__name__)
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json
from api.error_handler import raise_server_error

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


def _is_global_company_value(value: Any) -> bool:
    if value is None:
        return True
    text_value = str(value).strip()
    return text_value == "" or text_value.lower() == "none"


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
        _logger.error("AI response could not be parsed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="The AI service returned an unexpected response. Please try again.")

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
    _agent_cnt_join = (
        f"""JOIN {CORE}.agents ag
                ON (
                    (rel.agent_id IS NOT NULL AND rel.agent_id <> '' AND ag.agent_id = rel.agent_id)
                    OR (
                        rel.agent_internal_id IS NOT NULL AND rel.agent_internal_id <> ''
                        AND ag.agent_internal_id = rel.agent_internal_id
                    )
                )"""
        if company_id else ""
    )
    _agent_cnt_cf = (
        "AND (ag.company_id = :cid OR ag.company_id IS NULL"
        " OR TRIM(CAST(ag.company_id AS text)) = '' OR ag.company_id = 'None')"
        if company_id else ""
    )

    # Build dynamic ARE/ART lateral when company_id is provided (mirrors _fetch_applications).
    _company_risk_lateral_sql = ""
    _company_risk_class_lateral_sql = ""
    _has_dynamic_risk = False
    _c_tid_filter = "AND rel2.tenant_id = :tid" if tenant_id else ""
    _agent_company_filter = (
        "AND (ag2.company_id = :cid OR ag2.company_id IS NULL"
        " OR TRIM(CAST(ag2.company_id AS text)) = '' OR ag2.company_id = 'None')"
    )

    if company_id:
        ara_exists = (await db.execute(
            text("SELECT to_regclass(:t)"), {"t": f"{CORE}.agent_risk_assessments"}
        )).scalar()
        if ara_exists:
            _has_dynamic_risk = True
            _company_risk_lateral_sql = f"""
                LEFT JOIN LATERAL (
                    SELECT
                        base.company_blended_risk_score AS cmp_brs,
                        base.worst_agent_internal_id,
                        base.company_are AS cmp_are,
                        CASE
                            WHEN base.company_are >= 9.0 THEN 'Critical'
                            WHEN base.company_are >= 7.0 THEN 'High'
                            WHEN base.company_are >= 3.0 THEN 'Medium'
                            ELSE 'Low'
                        END AS cmp_art
                    FROM (
                        SELECT
                            agg.max_brs::double precision AS company_blended_risk_score,
                            agg.worst_agent_internal_id,
                            ROUND((agg.max_brs * (
                                CASE LOWER(TRIM(m.business_criticality))
                                    WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.4 WHEN 'low' THEN 0.1 ELSE 0.0
                                END +
                                CASE LOWER(TRIM(m.emergency_tier))
                                    WHEN 'mission critical' THEN 1.0 WHEN 'business critical' THEN 0.4
                                    WHEN 'non-critical' THEN 0.1 WHEN 'non critical' THEN 0.1 ELSE 0.0
                                END
                            ) / 2.0)::numeric, 2)::double precision AS company_are
                        FROM (
                            SELECT
                                COALESCE(MAX(brs.blended_risk_score), 0.0) AS max_brs,
                                (array_agg(COALESCE(ag2.agent_internal_id, rel2.agent_internal_id) ORDER BY brs.blended_risk_score DESC NULLS LAST))[1] AS worst_agent_internal_id
                            FROM {CORE}.agent_ai_models rel2
                            JOIN {CORE}.agents ag2
                                ON (
                                    (rel2.agent_id IS NOT NULL AND rel2.agent_id <> '' AND ag2.agent_id = rel2.agent_id)
                                    OR (
                                        rel2.agent_internal_id IS NOT NULL AND rel2.agent_internal_id <> ''
                                        AND ag2.agent_internal_id = rel2.agent_internal_id
                                    )
                                )
                            JOIN LATERAL (
                                SELECT ara.blended_risk_score
                                FROM {CORE}.agent_risk_assessments ara
                                WHERE (
                                    (rel2.agent_id IS NOT NULL AND rel2.agent_id <> '' AND ara.agent_id = rel2.agent_id)
                                    OR (
                                        rel2.agent_internal_id IS NOT NULL AND rel2.agent_internal_id <> ''
                                        AND ara.agent_internal_id = rel2.agent_internal_id
                                    )
                                )
                                  AND ara.blended_risk_score IS NOT NULL
                                ORDER BY
                                    CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                                    ara.assessment_ts DESC NULLS LAST,
                                    ara.updated_ts DESC NULLS LAST
                                LIMIT 1
                            ) brs ON TRUE
                            WHERE LOWER(TRIM(rel2.ai_model_id)) = LOWER(TRIM(m.ai_model_id))
                              AND COALESCE(rel2.agent_id, rel2.agent_internal_id) IS NOT NULL
                              AND COALESCE(rel2.agent_id, rel2.agent_internal_id) <> ''
                              {_agent_company_filter}
                              {_c_tid_filter}
                        ) agg
                    ) base
                ) company_risk ON TRUE
            """
            rm_exists = (await db.execute(
                text("SELECT to_regclass(:t)"), {"t": f"{RISK_MANAGEMENT}.agent_risk_assessment"}
            )).scalar()
            if rm_exists:
                _company_risk_class_lateral_sql = f"""
                    LEFT JOIN LATERAL (
                        SELECT
                            MAX(CASE WHEN ara.type_of_risk = 'Inherent Risk' THEN ara.risk_classification END) AS cmp_inherent_class,
                            COALESCE(MAX(CASE WHEN ara.type_of_risk = 'Inherent Risk' THEN ara.risk_classification_score::double precision END), 0.0) AS cmp_inherent_score,
                            MAX(CASE WHEN ara.type_of_risk = 'Residual Risk' THEN ara.risk_classification END) AS cmp_residual_class,
                            COALESCE(MAX(CASE WHEN ara.type_of_risk = 'Residual Risk' THEN ara.risk_classification_score::double precision END), 0.0) AS cmp_residual_score
                        FROM {RISK_MANAGEMENT}.agent_risk_assessment ara
                        WHERE ara.agent_internal_id = company_risk.worst_agent_internal_id
                          AND company_risk.worst_agent_internal_id IS NOT NULL
                          AND ara.type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ) company_risk_class ON TRUE
                """
            else:
                _company_risk_class_lateral_sql = """
                    LEFT JOIN LATERAL (
                        SELECT
                            NULL::text AS cmp_inherent_class,
                            0.0::double precision AS cmp_inherent_score,
                            NULL::text AS cmp_residual_class,
                            0.0::double precision AS cmp_residual_score
                    ) company_risk_class ON TRUE
                """

    _dynamic_risk_cols = """,
                        company_risk.cmp_brs AS _cmp_brs,
                        company_risk.cmp_are AS _cmp_are,
                        company_risk.cmp_art AS _cmp_art,
                        company_risk_class.cmp_inherent_class AS _cmp_inherent_class,
                        company_risk_class.cmp_inherent_score AS _cmp_inherent_score,
                        company_risk_class.cmp_residual_class AS _cmp_residual_class,
                        company_risk_class.cmp_residual_score AS _cmp_residual_score
                    """ if _has_dynamic_risk else ""

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
                              AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
                              AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
                              {rel_tenant_filter}
                              {_agent_cnt_cf}
                        ), 0) AS related_agent_count
                        {_dynamic_risk_cols},
                        ROW_NUMBER() OVER (ORDER BY m.created_ts DESC NULLS LAST) AS rn,
                        COUNT(*) OVER () AS total_records
                    FROM {CORE}.ai_models m
                    {_company_risk_lateral_sql}
                    {_company_risk_class_lateral_sql}
                    WHERE {where_sql}
                ) t
                WHERE rn BETWEEN :start AND :end
            """),
            {**params, "start": start, "end": end},
        )
        rows = result.mappings().all()
        total = int(rows[0]["total_records"]) if rows else 0
        data = []
        for r in rows:
            row = {k: v for k, v in r.items() if k not in (
                "rn", "total_records", "_cmp_brs", "_cmp_are", "_cmp_art",
                "_cmp_inherent_class", "_cmp_inherent_score", "_cmp_residual_class", "_cmp_residual_score",
            )}
            if company_id:
                row["no_of_associated_agents"] = r["related_agent_count"]
            if _has_dynamic_risk:
                row["blended_risk_score"] = r["_cmp_brs"]
                row["agent_risk_exposure"] = r["_cmp_are"]
                row["agent_risk_tier"] = r["_cmp_art"]
                row["inherent_risk_classification"] = r["_cmp_inherent_class"]
                row["inherent_risk_classification_score"] = r["_cmp_inherent_score"]
                row["residual_risk_classification"] = r["_cmp_residual_class"]
                row["residual_risk_classification_score"] = r["_cmp_residual_score"]
            data.append(row)
        return {"start_record": start, "end_record": end, "record_count": len(data),
                "total_records": total, "items": data, "data": data}
    except Exception as e:
        raise_server_error(e)


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
        raise_server_error(e)


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

    agent_relation_company_filter = (
        "AND (rel.company_id = :company_id"
        " OR rel.company_id IS NULL"
        " OR TRIM(CAST(rel.company_id AS text)) = ''"
        " OR rel.company_id = 'None'"
        " OR a.company_id IS NULL"
        " OR TRIM(CAST(a.company_id AS text)) = ''"
        " OR a.company_id = 'None')"
        if company_id
        else ""
    )

    rel_params: dict[str, Any] = {"mid": mid}
    if company_id:
        rel_params["company_id"] = company_id
    if tenant_id:
        rel_params["tid"] = tenant_id

    agent_catalog_join = (
        f"""JOIN {CORE}.agents a
                ON (
                    (rel.agent_id IS NOT NULL AND rel.agent_id <> '' AND a.agent_id = rel.agent_id)
                    OR (
                        rel.agent_internal_id IS NOT NULL AND rel.agent_internal_id <> ''
                        AND a.agent_internal_id = rel.agent_internal_id
                    )
                )
                AND COALESCE(a.is_current, true) = true"""
        if company_id
        else f"""LEFT JOIN {CORE}.agents a
                ON (
                    (rel.agent_id IS NOT NULL AND rel.agent_id <> '' AND a.agent_id = rel.agent_id)
                    OR (
                        rel.agent_internal_id IS NOT NULL AND rel.agent_internal_id <> ''
                        AND a.agent_internal_id = rel.agent_internal_id
                    )
                )
                AND COALESCE(a.is_current, true) = true"""
    )

    agent_rows = await db.execute(
        text(f"""
            SELECT
                rel.agent_id,
                rel.agent_internal_id,
                COALESCE(a.agent_name, rel.agent_name, rel.agent_id) AS agent_name
            FROM {CORE}.agent_ai_models rel
            {agent_catalog_join}
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
              AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
              {_tf('rel')}
              {agent_relation_company_filter}
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

    if company_id:
        _agent_join = f"""
            JOIN {CORE}.agents ag
                ON (
                    (rel.agent_id IS NOT NULL AND rel.agent_id <> '' AND ag.agent_id = rel.agent_id)
                    OR (
                        rel.agent_internal_id IS NOT NULL AND rel.agent_internal_id <> ''
                        AND ag.agent_internal_id = rel.agent_internal_id
                    )
                )
        """
        _ci_agent = (" OR ag.company_id IS NULL OR TRIM(CAST(ag.company_id AS text)) = ''"
                     " OR ag.company_id = 'None'")
        _rel_cf = f"AND (ag.company_id = :company_id{_ci_agent})"
        _rel_tf = "AND rel.tenant_id = :tid" if tenant_id else ""
        risk_params: dict[str, Any] = {"mid": mid, "company_id": company_id}
        if tenant_id:
            risk_params["tid"] = tenant_id

        cnt_row = await db.execute(
            text(f"""
                SELECT COUNT(DISTINCT COALESCE(rel.agent_id, rel.agent_internal_id))::int AS cnt
                FROM {CORE}.agent_ai_models rel
                {_agent_join}
                WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
                  AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
                  AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
                  {_rel_cf}
                  {_rel_tf}
            """),
            risk_params,
        )
        result["no_of_associated_agents"] = int(cnt_row.scalar() or 0)

        ara_exists = (await db.execute(
            text("SELECT to_regclass(:t)"), {"t": f"{CORE}.agent_risk_assessments"}
        )).scalar()

        if ara_exists:
            worst_row = await db.execute(
                text(f"""
                    SELECT brs.agent_internal_id, brs.blended_risk_score
                    FROM {CORE}.agent_ai_models rel
                    {_agent_join}
                    JOIN LATERAL (
                        SELECT COALESCE(ara.agent_internal_id, ag.agent_internal_id, rel.agent_internal_id) AS agent_internal_id,
                               ara.blended_risk_score
                        FROM {CORE}.agent_risk_assessments ara
                        WHERE (
                            (rel.agent_id IS NOT NULL AND rel.agent_id <> '' AND ara.agent_id = rel.agent_id)
                            OR (
                                rel.agent_internal_id IS NOT NULL AND rel.agent_internal_id <> ''
                                AND ara.agent_internal_id = rel.agent_internal_id
                            )
                        )
                          AND ara.blended_risk_score IS NOT NULL
                        ORDER BY
                            CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                            ara.assessment_ts DESC NULLS LAST,
                            ara.updated_ts DESC NULLS LAST
                        LIMIT 1
                    ) brs ON TRUE
                    WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
                      AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
                      AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
                      {_rel_cf}
                      {_rel_tf}
                    ORDER BY brs.blended_risk_score DESC NULLS LAST
                    LIMIT 1
                """),
                risk_params,
            )
            worst = worst_row.mappings().first()
            max_brs = float(worst.get("blended_risk_score") or 0.0) if worst else 0.0
            worst_internal_id = worst.get("agent_internal_id") if worst else None

            bc = (result.get("business_criticality") or "").strip().lower()
            bc_score = {"high": 1.0, "medium": 0.4, "low": 0.1}.get(bc, 0.0)
            et = (result.get("emergency_tier") or "").strip().lower()
            et_score = {"mission critical": 1.0, "business critical": 0.4,
                        "non-critical": 0.1, "non critical": 0.1}.get(et, 0.0)
            are = round(max_brs * (bc_score + et_score) / 2.0, 2)
            if are >= 9.0: art = "Critical"
            elif are >= 7.0: art = "High"
            elif are >= 3.0: art = "Medium"
            else: art = "Low"

            result["blended_risk_score"] = max_brs
            result["agent_risk_exposure"] = are
            result["agent_risk_tier"] = art

            inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
            if worst_internal_id:
                rm_exists = (await db.execute(
                    text("SELECT to_regclass(:t)"), {"t": f"{RISK_MANAGEMENT}.agent_risk_assessment"}
                )).scalar()
                if rm_exists:
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
                    for rc in rc_rows.mappings():
                        tor = rc.get("type_of_risk")
                        if tor == "Inherent Risk" and not inherent_class:
                            inherent_class = rc.get("risk_classification") or ""
                            inherent_score = float(rc.get("risk_classification_score") or 0.0)
                        elif tor == "Residual Risk" and not residual_class:
                            residual_class = rc.get("risk_classification") or ""
                            residual_score = float(rc.get("risk_classification_score") or 0.0)
            result["inherent_risk_classification"] = inherent_class
            result["inherent_risk_classification_score"] = inherent_score
            result["residual_risk_classification"] = residual_class
            result["residual_risk_classification_score"] = residual_score
        else:
            result["blended_risk_score"] = 0.0
            result["agent_risk_exposure"] = 0.0
            result["agent_risk_tier"] = "Low"
            result["inherent_risk_classification"] = ""
            result["inherent_risk_classification_score"] = 0.0
            result["residual_risk_classification"] = ""
            result["residual_risk_classification_score"] = 0.0

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
        raise_server_error(e)


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
        raise_server_error(e)


# ---------------------------------------------------------------------------
# POST /{ai_model_id}/agents  — link agent
# ---------------------------------------------------------------------------

@router.post("/{ai_model_id}/agents", summary="Link Agent to AI Model")
async def link_agent(
    ai_model_id: str,
    body: LinkAgentRequest,
    request: Request,
    company_id: Optional[str] = Query(default=None, description="Current company UUID"),
    db: AsyncSession = Depends(get_db),
):
    mid = _norm_id(ai_model_id)
    agent_id = body.agent_id
    tenant_id = _tenant(request)
    tenant_filter = "AND tenant_id = :tid" if tenant_id else ""
    company_filter = (
        "AND (company_id = :company_id OR company_id IS NULL OR TRIM(CAST(company_id AS text)) = '' OR company_id = 'None')"
        if company_id
        else ""
    )
    try:
        model_row = await db.execute(
            text(
                f"""
                SELECT ai_model_id, model_name, company_id, tenant_id
                FROM {CORE}.ai_models
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  {tenant_filter}
                  {company_filter}
                LIMIT 1
                """
            ),
            {"mid": mid, "tid": tenant_id, "company_id": company_id},
        )
        model = model_row.mappings().first()
        if not model:
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        agent_row = await db.execute(
            text(
                f"""
                SELECT agent_internal_id, agent_name, company_id
                FROM {CORE}.agents
                WHERE agent_id = :aid
                  AND is_current = true
                  {tenant_filter}
                LIMIT 1
                """
            ),
            {"aid": agent_id, "tid": tenant_id, "company_id": company_id},
        )
        agent = agent_row.mappings().first()
        if not agent:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found for the selected company.")
        agent_internal_id = str(agent["agent_internal_id"])
        agent_name = str(agent.get("agent_name") or "")
        relation_company_id = None if _is_global_company_value(agent.get("company_id")) else (
            company_id or model.get("company_id")
        )

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
                    company_id = EXCLUDED.company_id,
                    updated_ts = EXCLUDED.updated_ts
            """),
            {
                "tid": tenant_id or model.get("tenant_id"),
                "cid": relation_company_id,
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
        raise_server_error(e)


# ---------------------------------------------------------------------------
# DELETE /{ai_model_id}/agents/{agent_id}  — unlink agent
# ---------------------------------------------------------------------------

@router.delete("/{ai_model_id}/agents/{agent_id}", summary="Unlink Agent from AI Model")
async def unlink_agent(
    ai_model_id: str,
    agent_id: str,
    request: Request,
    company_id: Optional[str] = Query(default=None, description="Current company UUID"),
    db: AsyncSession = Depends(get_db),
):
    mid = _norm_id(ai_model_id)
    tenant_id = _tenant(request)
    tenant_filter = "AND tenant_id = :tid" if tenant_id else ""
    company_filter = (
        "AND (company_id = :company_id OR company_id IS NULL OR TRIM(CAST(company_id AS text)) = '' OR company_id = 'None')"
        if company_id
        else ""
    )
    try:
        result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.agent_ai_models
                WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid))
                  AND agent_id = :aid
                  {tenant_filter}
                  {company_filter}
            """),
            {"mid": mid, "aid": agent_id, "tid": tenant_id, "company_id": company_id},
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No active link found for agent '{agent_id}' on model '{mid}' with the given company/tenant.",
            )
        await _refresh_model_rollup(db, mid)
        await db.commit()
        return {"status": "unlinked", "ai_model_id": mid, "agent_id": agent_id, "rows_deleted": result.rowcount or 0}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise_server_error(e)


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
        raise_server_error(e)


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
        raise_server_error(e)


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
        raise_server_error(e)


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
        raise_server_error(e)


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
        raise_server_error(e)


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
        raise_server_error(e)


async def _refresh_model_rollup(db: AsyncSession, ai_model_id: str) -> None:
    await db.execute(
        text(f"""
            UPDATE {CORE}.ai_models
            SET no_of_associated_agents = (
                SELECT COUNT(DISTINCT COALESCE(rel.agent_id, rel.agent_internal_id))
                FROM {CORE}.agent_ai_models rel
                WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
                  AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
                  AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
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
                WHERE (ara.agent_id = rel.agent_id
                       OR (ara.agent_internal_id = rel.agent_internal_id
                           AND rel.agent_internal_id IS NOT NULL
                           AND rel.agent_internal_id <> ''))
                  AND ara.blended_risk_score IS NOT NULL
                ORDER BY
                    CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                    ara.assessment_ts DESC NULLS LAST,
                    ara.updated_ts DESC NULLS LAST
                LIMIT 1
            ) brs ON TRUE
            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(:mid))
              AND COALESCE(rel.agent_id, rel.agent_internal_id) IS NOT NULL
              AND COALESCE(rel.agent_id, rel.agent_internal_id) <> ''
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
