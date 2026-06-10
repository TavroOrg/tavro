from __future__ import annotations
import json
import os
import base64
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()

CORE = os.getenv("CORE_DB_NAME", "core")

# Catalog columns that may be supplied on create/update (everything except the
# system-managed ones: tenant_id, ai_model_id, no_of_associated_agents,
# agent_internal_id, created_ts, updated_ts).
_AI_MODEL_EDITABLE_COLUMNS: List[str] = [
    # Identification & Accountability
    "model_name", "owner", "description", "department_executive",
    "business_functions", "vendor_or_inhouse", "provider", "status",
    "parent_model_id", "version_number",
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


class AiModelCreate(AiModel):
    pass


class AiModelUpdate(AiModel):
    pass


class LinkAgentRequest(BaseModel):
    agent_id: str


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
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 499

    tenant_id = _tenant(request)
    where_clauses: List[str] = ["m.ai_model_id IS NOT NULL", "m.ai_model_id <> ''"]
    params: Dict[str, Any] = {}
    if tenant_id:
        where_clauses.append(
            "(m.tenant_id = :tid OR m.tenant_id IS NULL OR m.tenant_id = '' OR m.tenant_id = 'None')"
        )
        params["tid"] = tenant_id
    if q and q.strip():
        where_clauses.append(
            "(LOWER(m.model_name) LIKE LOWER(:q) OR LOWER(m.ai_model_id) LIKE LOWER(:q) OR LOWER(COALESCE(m.description,'')) LIKE LOWER(:q))"
        )
        params["q"] = f"%{q.strip()}%"
    where_sql = " AND ".join(where_clauses)

    rel_tenant_filter = (
        "AND (rel.tenant_id = :tid OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
        if tenant_id
        else ""
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
                            WHERE LOWER(TRIM(rel.ai_model_id)) = LOWER(TRIM(m.ai_model_id))
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {rel_tenant_filter}
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
async def create_ai_model(body: AiModelCreate, request: Request, db: AsyncSession = Depends(get_db)):
    ai_model_id = str(uuid.uuid4())
    tenant_id = _tenant(request)

    payload = body.model_dump(exclude_none=True)
    columns = ["tenant_id", "ai_model_id", "no_of_associated_agents", "created_ts", "updated_ts"]
    placeholders = [":tid", ":mid", "0", "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP"]
    params: Dict[str, Any] = {"tid": tenant_id, "mid": ai_model_id}
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
async def get_ai_model(ai_model_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant_id = _tenant(request)
    mid = _norm_id(ai_model_id)
    tenant_filter = (
        "AND (m.tenant_id = :tid OR m.tenant_id IS NULL OR m.tenant_id = '' OR m.tenant_id = 'None')"
        if tenant_id else ""
    )
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
            ORDER BY LOWER(COALESCE(a.agent_name, rel.agent_name, rel.agent_id))
        """),
        {"mid": mid},
    )
    result = dict(model)
    result["agents"] = [dict(r._mapping) for r in agent_rows]
    return result


# ---------------------------------------------------------------------------
# PUT /{ai_model_id}  — update AI model
# ---------------------------------------------------------------------------

@router.put("/{ai_model_id}", summary="Update AI Model")
async def update_ai_model(ai_model_id: str, body: AiModelUpdate, db: AsyncSession = Depends(get_db)):
    mid = _norm_id(ai_model_id)
    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {CORE}.ai_models WHERE ai_model_id = :mid LIMIT 1"),
            {"mid": mid},
        )
        if not exists.first():
            raise HTTPException(status_code=404, detail=f"AI Model '{mid}' not found.")

        payload = body.model_dump(exclude_none=True)
        sets: List[str] = ["updated_ts = CURRENT_TIMESTAMP"]
        params: Dict[str, Any] = {"mid": mid}
        for col in _AI_MODEL_EDITABLE_COLUMNS:
            if col in payload:
                sets.append(f"{col} = :{col}")
                params[col] = payload[col]

        await db.execute(
            text(f"UPDATE {CORE}.ai_models SET {', '.join(sets)} WHERE ai_model_id = :mid"),
            params,
        )
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
            text(f"SELECT ai_model_id, model_name FROM {CORE}.ai_models WHERE LOWER(TRIM(ai_model_id)) = LOWER(TRIM(:mid)) LIMIT 1"),
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
                    (tenant_id, ai_model_id, model_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts)
                VALUES
                    (:tid, :mid, :mname, :aid, :aname, :iid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
