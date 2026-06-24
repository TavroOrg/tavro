from __future__ import annotations
import json
import os
import base64
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()

CORE = os.getenv("CORE_DB_NAME", "core")
RISK_MANAGEMENT = os.getenv("RISK_MANAGEMENT_DB_NAME", "risk_management")

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


def _art_from_are(are: float) -> str:
    if are >= 9.0:
        return "Critical"
    if are >= 7.0:
        return "High"
    if are >= 3.0:
        return "Medium"
    return "Low"


async def _refresh_use_case_rollup(db: AsyncSession, use_case_id: str, tenant_id: Optional[str]) -> int:
    relation_tenant_filter = (
        "AND (rel.tenant_id = :tid OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
        if tenant_id
        else ""
    )
    use_case_tenant_filter = (
        "AND (tenant_id = :tid OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
        if tenant_id
        else ""
    )

    count_row = await db.execute(
        text(
            f"""
            SELECT COUNT(DISTINCT rel.agent_id)::int AS link_count
            FROM {CORE}.agent_ai_use_cases rel
            WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(:uid))
              AND rel.agent_id IS NOT NULL
              AND rel.agent_id <> ''
              {relation_tenant_filter}
            """
        ),
        {"uid": use_case_id, "tid": tenant_id},
    )
    associated_count = int(count_row.scalar() or 0)

    risk_table = (
        await db.execute(text("SELECT to_regclass(:table_name)"), {"table_name": f"{CORE}.agent_risk_assessments"})
    ).scalar()
    max_brs = 0.0
    worst_internal_id = None
    if risk_table:
        risk_row = await db.execute(
            text(
                f"""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {CORE}.agent_ai_use_cases rel
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {CORE}.agent_risk_assessments ara
                    WHERE ara.blended_risk_score IS NOT NULL
                      AND (
                        ara.agent_id = rel.agent_id
                        OR (
                            rel.agent_internal_id IS NOT NULL
                            AND rel.agent_internal_id <> ''
                            AND ara.agent_internal_id = rel.agent_internal_id
                        )
                      )
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND rel.agent_id IS NOT NULL
                  AND rel.agent_id <> ''
                  {relation_tenant_filter}
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
                """
            ),
            {"uid": use_case_id, "tid": tenant_id},
        )
        worst_row = risk_row.mappings().first()
        if worst_row:
            max_brs = float(worst_row.get("blended_risk_score") or 0.0)
            worst_internal_id = worst_row.get("agent_internal_id")

    inherent_class = ""
    inherent_score = 0.0
    residual_class = ""
    residual_score = 0.0
    if worst_internal_id:
        rc_rows = await db.execute(
            text(
                f"""
                SELECT type_of_risk, risk_classification, risk_classification_score
                FROM {RISK_MANAGEMENT}.agent_risk_assessment
                WHERE agent_internal_id = :aid
                  AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                ORDER BY created_ts DESC NULLS LAST
                """
            ),
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

    are = round(max_brs, 2)
    art = _art_from_are(are) if associated_count > 0 else "None"

    await db.execute(
        text(
            f"""
            UPDATE {CORE}.ai_use_cases
            SET
                no_of_associated_agents = :cnt,
                blended_risk_score = :max_brs,
                agent_risk_exposure_are = :are,
                agent_risk_tier_art = :art,
                inherent_risk_classification = :inherent_class,
                inherent_risk_classification_score = :inherent_score,
                residual_risk_classification = :residual_class,
                residual_risk_classification_score = :residual_score,
                updated_ts = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
              {use_case_tenant_filter}
            """
        ),
        {
            "cnt": associated_count, "max_brs": max_brs, "are": are, "art": art,
            "inherent_class": inherent_class, "inherent_score": inherent_score,
            "residual_class": residual_class, "residual_score": residual_score,
            "uid": use_case_id, "tid": tenant_id,
        },
    )
    return associated_count


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
    assumptions: Optional[str] = None
    quantified_financial_benefits: Optional[str] = None
    total_financial_impact_summary: Optional[str] = None
    implementation_cost_estimate: Optional[str] = None
    return_on_investment: Optional[str] = None
    risk_considerations: Optional[str] = None
    implementation_roadmap: Optional[str] = None
    recommendation: Optional[str] = None


class LinkAgentRequest(BaseModel):
    agent_id: str

class LinkProcessRequest(BaseModel):
    process_id: str


class LinkApplicationRequest(BaseModel):
    application_id: str


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
    company_id: Optional[str] = Query(default=None, description="Filter by company UUID"),
    tenant_id: Optional[str] = Query(default=None, description="Filter by tenant ID"),
    start_record: int = 1,
    record_range: str = "1-10",
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 9

    tenant_id = (tenant_id or "").strip() or _tenant(request)
    where_clauses: List[str] = []
    params: Dict[str, Any] = {}

    if tenant_id:
        where_clauses.append(
            "u.tenant_id = :tid"
        )
        params["tid"] = tenant_id
    if company_id and company_id.strip():
        try:
            col_check = await db.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                    LIMIT 1
                """),
                {"schema": CORE, "tbl": "ai_use_cases"},
            )
            if col_check.first():
                where_clauses.append(
                    "(CAST(u.company_id AS text) = :company_id OR u.company_id IS NULL OR TRIM(CAST(u.company_id AS text)) = '' OR u.company_id = 'None')"
                )
                params["company_id"] = company_id.strip()
        except Exception:
            pass
    if title:
        where_clauses.append("LOWER(u.name) LIKE LOWER(:title)")
        params["title"] = f"%{title}%"
    if process_id and process_id.strip():
        normalized_process_id = _norm_id(process_id)
        process_filter = [
            "LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(u.ai_use_case_id))",
            "LOWER(TRIM(rel.business_process_id)) = LOWER(TRIM(:process_id))",
        ]
        if tenant_id:
            process_filter.append(
                "rel.tenant_id = :tid"
            )
        where_clauses.append(
            "EXISTS (SELECT 1 FROM "
            f"{CORE}.ai_use_case_business_processes rel WHERE {' AND '.join(process_filter)})"
        )
        params["process_id"] = normalized_process_id

    where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

    # Company filter for the agent count subqueries — join agents table to apply company_id.
    _has_company = "company_id" in params
    _agent_cnt_join = f"JOIN {CORE}.agents ag ON ag.agent_id = rel.agent_id" if _has_company else ""
    _agent_cnt_cf = (
        "AND (ag.company_id = :company_id OR ag.company_id IS NULL"
        " OR TRIM(CAST(ag.company_id AS text)) = '' OR ag.company_id = 'None')"
        if _has_company else ""
    )

    try:
        result = await db.execute(
            text(f"""
                SELECT *
                FROM (
                    SELECT
                        u.ai_use_case_id AS identifier,
                        u.ai_use_case_id,
                        u.name,
                        u.description,
                        u.owner,
                        u.problem_statement,
                        u.expected_benefits,
                        u.priority,
                        u.status,
                        u.solution_approach,
                        u.created_ts,
                        u.updated_ts,
                        COALESCE((
                            SELECT COUNT(DISTINCT rel.agent_id)
                            FROM {CORE}.agent_ai_use_cases rel
                            {_agent_cnt_join}
                            WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(u.ai_use_case_id))
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {"AND rel.tenant_id = :tid" if tenant_id else ""}
                              {_agent_cnt_cf}
                        ), 0) AS related_agent_count,
                        COALESCE((
                            SELECT COUNT(DISTINCT rel.agent_id)
                            FROM {CORE}.agent_ai_use_cases rel
                            {_agent_cnt_join}
                            WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(u.ai_use_case_id))
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {"AND rel.tenant_id = :tid" if tenant_id else ""}
                              {_agent_cnt_cf}
                        ), 0) AS no_of_associated_agents,
                        ROW_NUMBER() OVER (ORDER BY u.created_ts DESC) AS rn,
                        COUNT(*) OVER () AS total_records
                    FROM {CORE}.ai_use_cases u
                    WHERE u.ai_use_case_id IS NOT NULL
                      AND u.ai_use_case_id <> ''
                      AND {where_sql}
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
async def create_use_case(
    body: UseCaseCreateRequest,
    request: Request,
    company_id: Optional[str] = Query(default=None),
    company_name: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    use_case_id = str(uuid.uuid4())
    tenant_id = _tenant(request)
    cid = company_id.strip() if company_id and company_id.strip() else None
    cname = company_name.strip() if company_name and company_name.strip() else None
    try:
        priority = _normalize_priority(body.priority)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_use_cases
                    (tenant_id, ai_use_case_id, name, description, owner,
                     problem_statement, expected_benefits, priority, status,
                     solution_approach, created_ts, updated_ts, company_id, company_name)
                VALUES
                    (:tid, :uid, :name, :desc, :owner,
                     :problem, :benefits, :priority, 'New',
                     :solution, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :cid, :cname)
            """),
            {
                "tid": tenant_id, "uid": use_case_id,
                "name": body.title, "desc": body.description,
                "owner": body.use_case_owner or "System Administrator",
                "problem": body.business_problem_statement,
                "benefits": body.expected_benefits,
                "priority": priority,
                "solution": body.solution_approach or "",
                "cid": cid, "cname": cname,
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
async def get_use_case(use_case_id: str, request: Request, db: AsyncSession = Depends(get_db), company_id: Optional[str] = Query(default=None)):
    tenant_id = _tenant(request)
    normalized_use_case_id = _norm_id(use_case_id)
    use_case_tenant_filter = (
        "AND u.tenant_id = :tid"
        if tenant_id
        else ""
    )
    agent_tenant_filter = (
        "AND rel.tenant_id = :tid"
        if tenant_id
        else ""
    )
    process_tenant_filter = (
        "AND relp.tenant_id = :tid"
        if tenant_id
        else ""
    )
    application_tenant_filter = (
        "AND rela.tenant_id = :tid"
        if tenant_id
        else ""
    )
    _ci = " OR {col}.company_id IS NULL OR TRIM(CAST({col}.company_id AS text)) = '' OR {col}.company_id = 'None'"
    agent_company_filter = (
        f"AND (ag.company_id = :company_id{_ci.format(col='ag')})" if company_id else ""
    )
    process_company_filter = (
        f"AND (bp.company_id = :company_id{_ci.format(col='bp')})" if company_id else ""
    )
    application_company_filter = (
        f"AND (ba.company_id = :company_id{_ci.format(col='ba')})" if company_id else ""
    )
    model_company_filter = (
        f"AND (m.company_id = :company_id{_ci.format(col='m')})" if company_id else ""
    )
    agent_entity_tenant_filter = "AND ag.tenant_id = :tid" if tenant_id else ""
    process_entity_tenant_filter = "AND bp.tenant_id = :tid" if tenant_id else ""
    application_entity_tenant_filter = "AND ba.tenant_id = :tid" if tenant_id else ""
    model_entity_tenant_filter = "AND m.tenant_id = :tid" if tenant_id else ""
    try:
        await _refresh_use_case_rollup(db, normalized_use_case_id, tenant_id)
        await db.commit()

        result = await db.execute(
            text(f"""
                SELECT
                    u.ai_use_case_id AS identifier,
                    u.ai_use_case_id,
                    u.name, u.description, u.owner,
                    u.problem_statement, u.expected_benefits, u.priority,
                    u.status, u.solution_approach, u.created_ts, u.updated_ts,
                    u.agent_risk_exposure_are, u.no_of_associated_agents,
                    u.blended_risk_score,
                    u.inherent_risk_classification, u.residual_risk_classification,
                    u.inherent_risk_classification_score, u.residual_risk_classification_score,
                    u.agent_risk_tier_art,
                    u.assumptions, u.quantified_financial_benefits, u.total_financial_impact_summary,
                    u.implementation_cost_estimate, u.return_on_investment, u.risk_considerations,
                    u.implementation_roadmap, u.recommendation
                FROM {CORE}.ai_use_cases u
                WHERE LOWER(TRIM(u.ai_use_case_id)) = LOWER(TRIM(:uid))
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
                SELECT DISTINCT
                    rel.agent_id,
                    COALESCE(ag.agent_name, rel.agent_name) AS name,
                    ai.environment
                FROM {CORE}.agent_ai_use_cases rel
                LEFT JOIN {CORE}.agents ag
                    ON ag.agent_id = rel.agent_id AND ag.is_current = true
                LEFT JOIN {CORE}.agent_identifications ai
                    ON ai.agent_internal_id = rel.agent_internal_id
                    AND COALESCE(ai.is_current, true) = true
                WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(:uid)) AND rel.agent_id IS NOT NULL
                  {agent_tenant_filter}
                  {agent_company_filter}
                  {agent_entity_tenant_filter}
                ORDER BY name NULLS LAST
            """),
            {"uid": normalized_use_case_id, "tid": tenant_id, "company_id": company_id},
        )
        linked_agents = [dict(r) for r in agents_result.mappings().all()]

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
                  {process_company_filter}
                  {process_entity_tenant_filter}
                ORDER BY process_sort_key
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id, "company_id": company_id},
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

        applications_result = await db.execute(
            text(
                f"""
                SELECT DISTINCT
                    rela.business_application_id,
                    COALESCE(ba.application_name, rela.application_name, rela.business_application_id) AS application_name,
                    ba.application_description AS description,
                    ba.business_criticality,
                    ba.emergency_tier,
                    LOWER(COALESCE(ba.application_name, rela.application_name, rela.business_application_id)) AS application_sort_key
                FROM {CORE}.ai_use_case_business_applications rela
                LEFT JOIN {CORE}.business_applications ba
                    ON ba.business_application_id = rela.business_application_id
                WHERE LOWER(TRIM(rela.ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND rela.business_application_id IS NOT NULL
                  AND rela.business_application_id <> ''
                  {application_tenant_filter}
                  {application_company_filter}
                  {application_entity_tenant_filter}
                ORDER BY application_sort_key
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id, "company_id": company_id},
        )
        linked_applications = [
            {
                "identifier": r["business_application_id"],
                "business_application_id": r["business_application_id"],
                "name": r["application_name"],
                "application_name": r["application_name"],
                "description": r["description"],
                "business_criticality": r["business_criticality"],
                "emergency_tier": r["emergency_tier"],
            }
            for r in applications_result.mappings().all()
        ]

        # Linked AI models (many-to-many via core.ai_model_ai_use_cases).
        # Guarded: the junction table may not exist before migration 004.
        linked_ai_models: List[Dict[str, Any]] = []
        model_junction = (
            await db.execute(text("SELECT to_regclass(:t)"), {"t": f"{CORE}.ai_model_ai_use_cases"})
        ).scalar()
        if model_junction:
            model_tenant_filter = (
                "AND relm.tenant_id = :tid"
                if tenant_id
                else ""
            )
            models_result = await db.execute(
                text(
                    f"""
                    SELECT DISTINCT
                        relm.ai_model_id,
                        COALESCE(m.model_name, relm.ai_model_name, relm.ai_model_id) AS model_name,
                        m.description,
                        m.provider,
                        m.status,
                        LOWER(COALESCE(m.model_name, relm.ai_model_name, relm.ai_model_id)) AS model_sort_key
                    FROM {CORE}.ai_model_ai_use_cases relm
                    LEFT JOIN {CORE}.ai_models m
                        ON LOWER(TRIM(m.ai_model_id)) = LOWER(TRIM(relm.ai_model_id))
                    WHERE LOWER(TRIM(relm.ai_use_case_id)) = LOWER(TRIM(:uid))
                      AND relm.ai_model_id IS NOT NULL
                      AND relm.ai_model_id <> ''
                      {model_tenant_filter}
                      {model_company_filter}
                      {model_entity_tenant_filter}
                    ORDER BY model_sort_key
                    """
                ),
                {"uid": normalized_use_case_id, "tid": tenant_id, "company_id": company_id},
            )
            linked_ai_models = [
                {
                    "identifier": r["ai_model_id"],
                    "ai_model_id": r["ai_model_id"],
                    "name": r["model_name"],
                    "model_name": r["model_name"],
                    "description": r["description"],
                    "provider": r["provider"],
                    "status": r["status"],
                }
                for r in models_result.mappings().all()
            ]

        data = {
            **dict(row),
            "of_associated_agents": linked_agents,
            "of_associated_business_applications": linked_applications,
            "applications": linked_applications,
            "of_associated_business_processes": linked_processes,
            "of_associated_ai_models": linked_ai_models,
            "ai_models": linked_ai_models,
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
            text(f"SELECT 1 FROM {CORE}.ai_use_cases WHERE ai_use_case_id = :uid LIMIT 1"),
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
        if body.assumptions is not None:
            sets.append("assumptions = :assumptions")
            params["assumptions"] = body.assumptions.strip()
        if body.quantified_financial_benefits is not None:
            sets.append("quantified_financial_benefits = :qfb")
            params["qfb"] = body.quantified_financial_benefits.strip()
        if body.total_financial_impact_summary is not None:
            sets.append("total_financial_impact_summary = :tfis")
            params["tfis"] = body.total_financial_impact_summary.strip()
        if body.implementation_cost_estimate is not None:
            sets.append("implementation_cost_estimate = :ice")
            params["ice"] = body.implementation_cost_estimate.strip()
        if body.return_on_investment is not None:
            sets.append("return_on_investment = :roi")
            params["roi"] = body.return_on_investment.strip()
        if body.risk_considerations is not None:
            sets.append("risk_considerations = :risk_cons")
            params["risk_cons"] = body.risk_considerations.strip()
        if body.implementation_roadmap is not None:
            sets.append("implementation_roadmap = :impl_roadmap")
            params["impl_roadmap"] = body.implementation_roadmap.strip()
        if body.recommendation is not None:
            sets.append("recommendation = :recommendation")
            params["recommendation"] = body.recommendation.strip()

        await db.execute(
            text(f"UPDATE {CORE}.ai_use_cases SET {', '.join(sets)} WHERE ai_use_case_id = :uid"),
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
            text(f"SELECT 1 FROM {CORE}.ai_use_cases WHERE ai_use_case_id = :uid LIMIT 1"),
            {"uid": use_case_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{use_case_id}' not found.")
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_use_case_business_processes WHERE ai_use_case_id = :uid"),
            {"uid": use_case_id},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_use_case_business_applications WHERE ai_use_case_id = :uid"),
            {"uid": use_case_id},
        )
        await db.execute(
            text("DELETE FROM public.use_case_attachment WHERE use_case_id = :uid"),
            {"uid": use_case_id},
        )
        await db.execute(
            text(f"DELETE FROM {CORE}.agent_ai_use_cases WHERE ai_use_case_id = :uid"),
            {"uid": use_case_id},
        )
        # Clean up AI Model <-> AI Use Case links (guarded: table may not exist yet).
        if (await db.execute(text("SELECT to_regclass(:t)"), {"t": f"{CORE}.ai_model_ai_use_cases"})).scalar():
            await db.execute(
                text(f"DELETE FROM {CORE}.ai_model_ai_use_cases WHERE ai_use_case_id = :uid"),
                {"uid": use_case_id},
            )
        await db.execute(
            text(f"DELETE FROM {CORE}.ai_use_cases WHERE ai_use_case_id = :uid"),
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
    normalized_use_case_id = _norm_id(use_case_id)
    tenant_id = _tenant(request)
    relation_tenant_filter = (
        "AND rel.tenant_id = :tid"
        if tenant_id
        else ""
    )
    use_case_tenant_filter = (
        "AND u.tenant_id = :tid"
        if tenant_id
        else ""
    )
    try:
        use_case_row = await db.execute(
            text(
                f"""
                SELECT ai_use_case_id, name, company_id
                FROM {CORE}.ai_use_cases u
                WHERE LOWER(TRIM(u.ai_use_case_id)) = LOWER(TRIM(:uid))
                  {use_case_tenant_filter}
                LIMIT 1
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        use_case = use_case_row.mappings().first()
        if not use_case:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        agent_row = await db.execute(
            text(f"SELECT agent_internal_id, agent_name FROM {CORE}.agents WHERE agent_id = :aid AND is_current = true LIMIT 1"),
            {"aid": agent_id},
        )
        agent = agent_row.mappings().first()
        if not agent:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        agent_internal_id = str(agent["agent_internal_id"])
        agent_name = str(agent.get("agent_name") or "")

        dup = await db.execute(
            text(
                f"""
                SELECT 1
                FROM {CORE}.agent_ai_use_cases rel
                WHERE LOWER(TRIM(rel.ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND rel.agent_id = :aid
                  {relation_tenant_filter}
                LIMIT 1
                """
            ),
            {"uid": normalized_use_case_id, "aid": agent_id, "tid": tenant_id},
        )
        if dup.first():
            associated_count = await _refresh_use_case_rollup(db, normalized_use_case_id, tenant_id)
            await db.commit()
            return {"message": "Relationship already exists", "associated_count": associated_count}

        await db.execute(
            text(
                f"""
                INSERT INTO {CORE}.agent_ai_use_cases
                    (tenant_id, company_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts)
                VALUES
                    (:tid, :cid, :uid, :uname, :aid, :aname, :iid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (tenant_id, ai_use_case_id, agent_id)
                DO UPDATE SET
                    ai_use_case_name = EXCLUDED.ai_use_case_name,
                    agent_name = EXCLUDED.agent_name,
                    agent_internal_id = EXCLUDED.agent_internal_id,
                    updated_ts = EXCLUDED.updated_ts
                """
            ),
            {
                "tid": tenant_id,
                "cid": use_case.get("company_id"),
                "uid": normalized_use_case_id,
                "uname": str(use_case.get("name") or normalized_use_case_id),
                "aid": agent_id,
                "aname": agent_name,
                "iid": agent_internal_id,
            },
        )

        new_count = await _refresh_use_case_rollup(db, normalized_use_case_id, tenant_id)
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
async def unlink_agent(use_case_id: str, agent_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _tenant(request)
    normalized_use_case_id = _norm_id(use_case_id)
    relation_tenant_filter = (
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )
    use_case_tenant_filter = (
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )
    try:
        exists = await db.execute(
            text(
                f"""
                SELECT 1
                FROM {CORE}.ai_use_cases
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  {use_case_tenant_filter}
                LIMIT 1
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        linked = await db.execute(
            text(
                f"""
                SELECT agent_id
                FROM {CORE}.agent_ai_use_cases
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  {relation_tenant_filter}
                """
            ),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        linked_ids = [
            str(r["agent_id"])
            for r in linked.mappings().all()
            if r["agent_id"] and str(r["agent_id"]).strip()
        ]

        if agent_id not in linked_ids:
            return {"message": "Relationship not found", "associated_count": len(linked_ids)}

        await db.execute(
            text(
                f"""
                DELETE FROM {CORE}.agent_ai_use_cases
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND agent_id = :aid
                  {relation_tenant_filter}
                """
            ),
            {"uid": normalized_use_case_id, "aid": agent_id, "tid": tenant_id},
        )
        new_count = await _refresh_use_case_rollup(db, normalized_use_case_id, tenant_id)

        await db.commit()
        return {"message": "Relationship removed", "associated_count": new_count}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /{use_case_id}/applications  — link business application
# ---------------------------------------------------------------------------

@router.post("/{use_case_id}/applications", summary="Link Application to AI Use Case")
async def link_application(use_case_id: str, body: LinkApplicationRequest, request: Request, db: AsyncSession = Depends(get_db)):
    normalized_use_case_id = _norm_id(use_case_id)
    requested_application_id = _norm_id(body.application_id)
    if not normalized_use_case_id:
        raise HTTPException(status_code=400, detail="AI Use Case ID is required.")
    if not requested_application_id:
        raise HTTPException(status_code=400, detail="Application ID is required.")

    tenant_id = _tenant(request)
    tenant_filter = (
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )

    try:

        uc_row = await db.execute(
            text(f"SELECT ai_use_case_id, company_id FROM {CORE}.ai_use_cases WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        use_case = uc_row.mappings().first()
        if not use_case:
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        application_row = await db.execute(
            text(f"""
                SELECT business_application_id, application_name
                FROM {CORE}.business_applications
                WHERE LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                {tenant_filter}
                LIMIT 1
            """),
            {"aid": requested_application_id, "tid": tenant_id},
        )
        application = application_row.mappings().first()
        if not application:
            raise HTTPException(status_code=404, detail=f"Application '{requested_application_id}' not found.")
        canonical_application_id = _norm_id(str(application.get("business_application_id") or requested_application_id))

        dup = await db.execute(
            text(f"""
                SELECT 1
                FROM {CORE}.ai_use_case_business_applications
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                  {tenant_filter}
                LIMIT 1
            """),
            {"uid": normalized_use_case_id, "aid": canonical_application_id, "tid": tenant_id},
        )
        if dup.first():
            cnt = await db.execute(
                text(f"""
                    SELECT COUNT(DISTINCT business_application_id)
                    FROM {CORE}.ai_use_case_business_applications
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                    {tenant_filter}
                """),
                {"uid": normalized_use_case_id, "tid": tenant_id},
            )
            return {"message": "Relationship already exists", "associated_count": int(cnt.scalar() or 0)}

        await db.execute(
            text(f"""
                INSERT INTO {CORE}.ai_use_case_business_applications (
                    tenant_id, company_id, ai_use_case_id, business_application_id, application_name, created_ts, updated_ts
                )
                VALUES (
                    :tid, :cid, :uid, :aid, :aname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """),
            {
                "tid": tenant_id,
                "cid": use_case.get("company_id"),
                "uid": normalized_use_case_id,
                "aid": canonical_application_id,
                "aname": application.get("application_name") or canonical_application_id,
            },
        )

        cnt = await db.execute(
            text(f"""
                SELECT COUNT(DISTINCT business_application_id)
                FROM {CORE}.ai_use_case_business_applications
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
# DELETE /{use_case_id}/applications/{application_id}  — unlink business application
# ---------------------------------------------------------------------------

@router.delete("/{use_case_id}/applications/{application_id}", summary="Unlink Application from AI Use Case")
async def unlink_application(use_case_id: str, application_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    normalized_use_case_id = _norm_id(use_case_id)
    normalized_application_id = _norm_id(application_id)
    if not normalized_use_case_id:
        raise HTTPException(status_code=400, detail="AI Use Case ID is required.")
    if not normalized_application_id:
        raise HTTPException(status_code=400, detail="Application ID is required.")

    tenant_id = _tenant(request)
    tenant_filter = (
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )

    try:
        uc_exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.ai_use_cases WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        if not uc_exists.first():
            raise HTTPException(status_code=404, detail=f"AI Use Case '{normalized_use_case_id}' not found.")

        exists = await db.execute(
            text(f"""
                SELECT 1
                FROM {CORE}.ai_use_case_business_applications
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                  {tenant_filter}
                LIMIT 1
            """),
            {"uid": normalized_use_case_id, "aid": normalized_application_id, "tid": tenant_id},
        )
        if not exists.first():
            fallback_exists = await db.execute(
                text(
                    f"""
                    SELECT 1
                    FROM {CORE}.ai_use_case_business_applications
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                      AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                    LIMIT 1
                    """
                ),
                {"uid": normalized_use_case_id, "aid": normalized_application_id},
            )
            if fallback_exists.first():
                await db.execute(
                    text(
                        f"""
                        DELETE FROM {CORE}.ai_use_case_business_applications
                        WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                          AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                        """
                    ),
                    {"uid": normalized_use_case_id, "aid": normalized_application_id},
                )
                cnt = await db.execute(
                    text(f"""
                        SELECT COUNT(DISTINCT business_application_id)
                        FROM {CORE}.ai_use_case_business_applications
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
                    SELECT COUNT(DISTINCT business_application_id)
                    FROM {CORE}.ai_use_case_business_applications
                    WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                    {tenant_filter}
                """),
                {"uid": normalized_use_case_id, "tid": tenant_id},
            )
            return {"message": "Relationship not found", "associated_count": int(cnt.scalar() or 0)}

        delete_result = await db.execute(
            text(f"""
                DELETE FROM {CORE}.ai_use_case_business_applications
                WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid))
                  AND LOWER(TRIM(business_application_id)) = LOWER(TRIM(:aid))
                  {tenant_filter}
            """),
            {"uid": normalized_use_case_id, "aid": normalized_application_id, "tid": tenant_id},
        )

        cnt = await db.execute(
            text(f"""
                SELECT COUNT(DISTINCT business_application_id)
                FROM {CORE}.ai_use_case_business_applications
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
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )

    try:
        uc_row = await db.execute(
            text(f"SELECT ai_use_case_id, company_id FROM {CORE}.ai_use_cases WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
            {"uid": normalized_use_case_id, "tid": tenant_id},
        )
        use_case = uc_row.mappings().first()
        if not use_case:
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
                    tenant_id, company_id, ai_use_case_id, business_process_id, process_name, created_ts, updated_ts
                )
                VALUES (
                    :tid, :cid, :uid, :pid, :pname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """),
            {
                "tid": tenant_id,
                "cid": use_case.get("company_id"),
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
        "AND tenant_id = :tid"
        if tenant_id
        else ""
    )

    try:
        uc_exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.ai_use_cases WHERE LOWER(TRIM(ai_use_case_id)) = LOWER(TRIM(:uid)) {tenant_filter} LIMIT 1"),
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
