# =============================================================
# api/routers/compliance.py
# CRUD for compliance items, dimensions, impacts, documents.
# =============================================================

import json
import uuid
import base64
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.routers.agents import _resolve_agent_llm
from api.routers.blueprint import _call_anthropic, _call_openai, _collect_text, _extract_json

router = APIRouter()


# =============================================================
# Schemas
# =============================================================

class ComplianceItemCreate(BaseModel):
    item_type:      str                     # regulation | policy
    scope:          str = 'external'
    name:           str
    short_name:     str | None = None
    description:    str | None = None
    issuing_body:   str | None = None
    jurisdiction:   list[str] = []
    industry_tags:  list[str] = []
    company_id:     str | None = None
    effective_date: str | None = None
    review_date:    str | None = None
    sunset_date:    str | None = None
    status:         str = 'active'

class ComplianceItemUpdate(BaseModel):
    name:           str | None = None
    short_name:     str | None = None
    description:    str | None = None
    issuing_body:   str | None = None
    jurisdiction:   list[str] | None = None
    industry_tags:  list[str] | None = None
    effective_date: str | None = None
    review_date:    str | None = None
    status:         str | None = None

class ComplianceDimCreate(BaseModel):
    compliance_item_id: str
    dim_type_id:        str
    label:              str
    summary:            str | None = None
    tags:               list[str] = []
    visibility:         str = 'internal'
    sensitive:          bool = False
    sort_order:         int = 0

class ComplianceDimUpdate(BaseModel):
    label:      str | None = None
    summary:    str | None = None
    tags:       list[str] | None = None
    visibility: str | None = None
    sensitive:  bool | None = None

class ComplianceImpactCreate(BaseModel):
    compliance_item_id: str
    company_id:         str
    dim_node_id:        str | None = None
    impact_level:       str = 'medium'
    impact_type:        list[str] = []
    gap_description:    str | None = None
    gap_status:         str = 'open'
    current_state:      str | None = None
    target_state:       str | None = None
    remediation_plan:   str | None = None
    due_date:           str | None = None
    evidence_notes:     str | None = None

class ComplianceImpactUpdate(BaseModel):
    impact_level:       str | None = None
    impact_type:        list[str] | None = None
    gap_description:    str | None = None
    gap_status:         str | None = None
    current_state:      str | None = None
    target_state:       str | None = None
    remediation_plan:   str | None = None
    due_date:           str | None = None
    evidence_notes:     str | None = None

class ComplianceDocCreate(BaseModel):
    compliance_item_id: str
    doc_type:           str = 'source'
    title:              str
    filename:           str | None = None
    mime_type:          str | None = None
    content_base64:     str | None = None   # base64 encoded file
    source_url:         str | None = None
    version:            str | None = None
    effective_date:     str | None = None


class ComplianceDescriptionSuggest(BaseModel):
    item_type:    str
    name:         str
    short_name:   str | None = None
    issuing_body: str | None = None

class ComplianceDescriptionSuggestResponse(BaseModel):
    description: str

REGULATION_DESCRIPTION_SYSTEM = """You are helping a user create a regulation record in Tavro.

Given a regulation name and optional acronym and issuing body, generate a short plain-text description.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Describe what the regulation generally covers and the kind of compliance obligation it creates.
- Use the acronym and issuing body only if provided.
- Do not invent specific clauses, penalties, dates, jurisdictions, control requirements, or applicability details unless they are explicit in the provided fields.
- If the regulation name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence regulation description"
}"""

POLICY_DESCRIPTION_SYSTEM = """You are helping a user create an internal policy record in Tavro.

Given a policy name and optional policy number or code, generate a short plain-text description.

Rules:
- Return ONLY a JSON object.
- No markdown, no code fences.
- Write 2-3 sentences.
- Describe what the policy is likely intended to govern and the kind of internal expectations it sets.
- Use the policy number or code only as an identifier if provided.
- Do not invent company-specific procedures, systems, owners, standards, approval workflows, or enforcement details unless they are explicit in the provided fields.
- If the policy name is ambiguous, keep the description generic and conservative.

Format:
{
  "description": "2-3 sentence policy description"
}"""


# =============================================================
# Helpers
# =============================================================

def _row_to_dict(row) -> dict:
    return dict(row._mapping)

def _array_literal(arr: list[str]) -> list[str]:
    """Return the list as-is — asyncpg handles Python lists as Postgres arrays."""
    return arr

def _parse_date(val: str | None):
    """Convert ISO date string to datetime.date for asyncpg, or None."""
    if not val:
        return None
    from datetime import date
    return date.fromisoformat(val)

async def _generate_compliance_description(body: ComplianceDescriptionSuggest) -> str:
    item_type = body.item_type.strip().lower()
    provider, api_key = _resolve_agent_llm()

    if item_type == "regulation":
        system_prompt = REGULATION_DESCRIPTION_SYSTEM
        context = [
            f"Regulation name: {body.name.strip()}",
            f"Short name / acronym: {body.short_name.strip()}" if body.short_name and body.short_name.strip() else "",
            f"Issuing body: {body.issuing_body.strip()}" if body.issuing_body and body.issuing_body.strip() else "",
        ]
    elif item_type == "policy":
        system_prompt = POLICY_DESCRIPTION_SYSTEM
        context = [
            f"Policy name: {body.name.strip()}",
        ]
    else:
        raise HTTPException(status_code=400, detail="item_type must be regulation or policy")

    user_prompt = "\n".join([line for line in context if line])
    user_prompt = f"""Generate a concise description for this {item_type}:

{user_prompt}

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


# =============================================================
# Compliance items
# =============================================================

@router.post('/suggest-description', response_model=ComplianceDescriptionSuggestResponse)
async def suggest_description(body: ComplianceDescriptionSuggest):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    try:
        description = await _generate_compliance_description(body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {str(e)[:200]}")

    return ComplianceDescriptionSuggestResponse(description=description)

@router.get('/items')
async def list_items(
    item_type:  str | None = Query(None),
    company_id: str | None = Query(None),
    status:     str | None = Query(None),
    search:     str | None = Query(None),
    offset:     int = Query(0),
    limit:      int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    where = ['1=1']
    params: dict[str, Any] = {'offset': offset, 'limit': limit}
    if item_type:   where.append('ci.item_type = :item_type');   params['item_type']   = item_type
    if company_id:  where.append('(ci.company_id = :company_id OR ci.company_id IS NULL)'); params['company_id'] = company_id
    if status:      where.append('ci.status = :status');         params['status']      = status
    if search:      where.append("ci.name ILIKE :search");       params['search']      = f'%{search}%'

    q = f"""
        SELECT ci.*,
               (SELECT count(*) FROM twin.compliance_dimension cd WHERE cd.compliance_item_id = ci.id AND cd.valid_to IS NULL) AS dim_count,
               (SELECT count(*) FROM twin.compliance_impact    ip WHERE ip.compliance_item_id = ci.id) AS impact_count,
               (SELECT count(*) FROM twin.compliance_document  dc WHERE dc.compliance_item_id = ci.id) AS doc_count
        FROM twin.compliance_item ci
        WHERE {' AND '.join(where)}
        ORDER BY ci.item_type, ci.name
        OFFSET :offset LIMIT :limit
    """
    rows = await db.execute(text(q), params)
    items = [_row_to_dict(r) for r in rows]

    total_q = f"SELECT count(*) FROM twin.compliance_item ci WHERE {' AND '.join(where)}"
    total = (await db.execute(text(total_q), {k:v for k,v in params.items() if k not in ('offset','limit')})).scalar()
    return {'total': total, 'offset': offset, 'limit': limit, 'items': items}


@router.get('/items/{item_id}')
async def get_item(item_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM twin.compliance_item WHERE id = :id"),
        {'id': item_id}
    )
    item = row.mappings().first()
    if not item: raise HTTPException(404, 'Not found')
    return dict(item)


@router.post('/items', status_code=201)
async def create_item(body: ComplianceItemCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(text("""
        INSERT INTO twin.compliance_item
            (item_type, scope, name, short_name, description, issuing_body,
             jurisdiction, industry_tags, company_id,
             effective_date, review_date, sunset_date, status)
        VALUES
            (:item_type, :scope, :name, :short_name, :description, :issuing_body,
             :jurisdiction, :industry_tags, :company_id,
             :effective_date, :review_date, :sunset_date, :status)
        RETURNING *
    """), {
        'item_type':      body.item_type,
        'scope':          body.scope,
        'name':           body.name,
        'short_name':     body.short_name,
        'description':    body.description,
        'issuing_body':   body.issuing_body,
        'jurisdiction':   _array_literal(body.jurisdiction),
        'industry_tags':  _array_literal(body.industry_tags),
        'company_id':     body.company_id,
        'effective_date': _parse_date(body.effective_date),
        'review_date':    _parse_date(body.review_date),
        'sunset_date':    _parse_date(body.sunset_date),
        'status':         body.status,
    })
    await db.commit()
    return dict(row.mappings().first())


@router.patch('/items/{item_id}')
async def update_item(item_id: str, body: ComplianceItemUpdate, db: AsyncSession = Depends(get_db)):
    updates = body.model_dump(exclude_none=True)
    if not updates: raise HTTPException(400, 'No fields to update')
    set_parts = []
    params: dict[str, Any] = {'id': item_id}
    for k, v in updates.items():
        if k in ('jurisdiction', 'industry_tags'):
            set_parts.append(f"{k} = :{k}")
            params[k] = _array_literal(v)
        else:
            set_parts.append(f"{k} = :{k}")
            params[k] = v
    row = await db.execute(
        text(f"UPDATE twin.compliance_item SET {', '.join(set_parts)} WHERE id = :id RETURNING *"),
        params
    )
    await db.commit()
    return dict(row.mappings().first())


@router.delete('/items/{item_id}', status_code=200)
async def delete_item(item_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.execute(text("SELECT name FROM twin.compliance_item WHERE id = :id"), {'id': item_id})
    item = row.mappings().first()
    if not item: raise HTTPException(404, 'Not found')
    await db.execute(text("DELETE FROM twin.compliance_item WHERE id = :id"), {'id': item_id})
    await db.commit()
    return {'deleted': item['name']}


# =============================================================
# Compliance dimension types
# =============================================================

@router.get('/dim-types')
async def list_dim_types(scope: str | None = Query(None), db: AsyncSession = Depends(get_db)):
    q = "SELECT * FROM twin.compliance_dim_type WHERE 1=1"
    params: dict = {}
    if scope:
        q += " AND (scope = :scope OR scope = 'both')"
        params['scope'] = scope
    q += " ORDER BY category, name"
    rows = await db.execute(text(q), params)
    return [_row_to_dict(r) for r in rows]


# =============================================================
# Compliance dimensions
# =============================================================

@router.get('/items/{item_id}/dimensions')
async def list_dimensions(item_id: str, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("""
        SELECT cd.*, cdt.name AS type_name, cdt.category AS type_category
        FROM twin.compliance_dimension cd
        JOIN twin.compliance_dim_type cdt ON cdt.id = cd.dim_type_id
        WHERE cd.compliance_item_id = :item_id AND cd.valid_to IS NULL
        ORDER BY cd.sort_order, cdt.category, cd.label
    """), {'item_id': item_id})
    return [_row_to_dict(r) for r in rows]


@router.post('/dimensions', status_code=201)
async def create_dimension(body: ComplianceDimCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(text("""
        INSERT INTO twin.compliance_dimension
            (compliance_item_id, dim_type_id, label, summary, tags, visibility, sensitive, sort_order)
        VALUES
            (:compliance_item_id, :dim_type_id, :label, :summary,
             cast(:tags as jsonb), :visibility, :sensitive, :sort_order)
        RETURNING *
    """), {
        'compliance_item_id': body.compliance_item_id,
        'dim_type_id':        body.dim_type_id,
        'label':              body.label,
        'summary':            body.summary,
        'tags':               json.dumps(body.tags),
        'visibility':         body.visibility,
        'sensitive':          body.sensitive,
        'sort_order':         body.sort_order,
    })
    await db.commit()
    return dict(row.mappings().first())


@router.patch('/dimensions/{dim_id}')
async def update_dimension(dim_id: str, body: ComplianceDimUpdate, db: AsyncSession = Depends(get_db)):
    updates = body.model_dump(exclude_none=True)
    if not updates: raise HTTPException(400, 'No fields')
    set_parts = []
    params: dict = {'id': dim_id}
    for k, v in updates.items():
        if k == 'tags':
            set_parts.append("tags = cast(:tags as jsonb)")
            params['tags'] = json.dumps(v)
        else:
            set_parts.append(f"{k} = :{k}")
            params[k] = v
    row = await db.execute(
        text(f"UPDATE twin.compliance_dimension SET {', '.join(set_parts)} WHERE id = :id RETURNING *"),
        params
    )
    await db.commit()
    return dict(row.mappings().first())


@router.delete('/dimensions/{dim_id}', status_code=200)
async def delete_dimension(dim_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("UPDATE twin.compliance_dimension SET valid_to = now() WHERE id = :id"),
        {'id': dim_id}
    )
    await db.commit()
    return {'archived': dim_id}


# =============================================================
# Compliance impact
# =============================================================

@router.get('/items/{item_id}/impacts')
async def list_impacts(
    item_id:    str,
    company_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = """
        SELECT ci.*, dn.label AS dim_node_label, dt.category AS dim_category
        FROM twin.compliance_impact ci
        LEFT JOIN twin.dim_node dn ON dn.id = ci.dim_node_id
        LEFT JOIN twin.dim_type dt ON dt.id = dn.dim_type_id
        WHERE ci.compliance_item_id = :item_id
    """
    params: dict = {'item_id': item_id}
    if company_id:
        q += " AND ci.company_id = :company_id"
        params['company_id'] = company_id
    q += " ORDER BY ci.impact_level DESC, dn.label"
    rows = await db.execute(text(q), params)
    return [_row_to_dict(r) for r in rows]


@router.post('/impacts', status_code=201)
async def create_impact(body: ComplianceImpactCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(text("""
        INSERT INTO twin.compliance_impact
            (compliance_item_id, company_id, dim_node_id, impact_level, impact_type,
             gap_description, gap_status, current_state, target_state,
             remediation_plan, due_date, evidence_notes)
        VALUES
            (:compliance_item_id, :company_id, :dim_node_id, :impact_level,
             :impact_type, :gap_description, :gap_status, :current_state,
             :target_state, :remediation_plan, :due_date, :evidence_notes)
        ON CONFLICT (compliance_item_id, company_id, dim_node_id)
        DO UPDATE SET
            impact_level     = EXCLUDED.impact_level,
            impact_type      = EXCLUDED.impact_type,
            gap_description  = EXCLUDED.gap_description,
            gap_status       = EXCLUDED.gap_status,
            current_state    = EXCLUDED.current_state,
            target_state     = EXCLUDED.target_state,
            remediation_plan = EXCLUDED.remediation_plan,
            due_date         = EXCLUDED.due_date,
            evidence_notes   = EXCLUDED.evidence_notes,
            updated_at       = now()
        RETURNING *
    """), {
        'compliance_item_id': body.compliance_item_id,
        'company_id':         body.company_id,
        'dim_node_id':        body.dim_node_id,
        'impact_level':       body.impact_level,
        'impact_type':        _array_literal(body.impact_type),
        'gap_description':    body.gap_description,
        'gap_status':         body.gap_status,
        'current_state':      body.current_state,
        'target_state':       body.target_state,
        'remediation_plan':   body.remediation_plan,
        'due_date':           body.due_date,
        'evidence_notes':     body.evidence_notes,
    })
    await db.commit()
    return dict(row.mappings().first())


@router.patch('/impacts/{impact_id}')
async def update_impact(impact_id: str, body: ComplianceImpactUpdate, db: AsyncSession = Depends(get_db)):
    updates = body.model_dump(exclude_none=True)
    if not updates: raise HTTPException(400, 'No fields')
    set_parts = []
    params: dict = {'id': impact_id}
    for k, v in updates.items():
        if k == 'impact_type':
            set_parts.append("impact_type = :impact_type")
            params['impact_type'] = _array_literal(v)
        else:
            set_parts.append(f"{k} = :{k}")
            params[k] = v
    row = await db.execute(
        text(f"UPDATE twin.compliance_impact SET {', '.join(set_parts)} WHERE id = :id RETURNING *"),
        params
    )
    await db.commit()
    return dict(row.mappings().first())


@router.delete('/impacts/{impact_id}', status_code=200)
async def delete_impact(impact_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM twin.compliance_impact WHERE id = :id"), {'id': impact_id})
    await db.commit()
    return {'deleted': impact_id}


# =============================================================
# Compliance documents
# =============================================================

@router.get('/items/{item_id}/documents')
async def list_documents(item_id: str, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(text("""
        SELECT id, compliance_item_id, doc_type, title, filename, mime_type,
               file_size_bytes, source_url, ai_summary, ai_processed,
               version, effective_date, created_at, updated_at
        FROM twin.compliance_document
        WHERE compliance_item_id = :item_id
        ORDER BY doc_type, created_at
    """), {'item_id': item_id})
    return [_row_to_dict(r) for r in rows]


@router.post('/documents', status_code=201)
async def create_document(body: ComplianceDocCreate, db: AsyncSession = Depends(get_db)):
    content_text = None
    file_size    = None

    if body.content_base64:
        raw = base64.b64decode(body.content_base64)
        file_size = len(raw)
        if body.mime_type == 'application/pdf':
            try:
                import pdfplumber, io
                with pdfplumber.open(io.BytesIO(raw)) as pdf:
                    content_text = '\n'.join(p.extract_text() or '' for p in pdf.pages)
            except Exception:
                content_text = '[PDF text extraction failed]'
        elif body.mime_type and body.mime_type.startswith('text/'):
            content_text = raw.decode('utf-8', errors='replace')[:50000]

    row = await db.execute(text("""
        INSERT INTO twin.compliance_document
            (compliance_item_id, doc_type, title, filename, mime_type,
             file_size_bytes, content_text, source_url, version, effective_date)
        VALUES
            (:compliance_item_id, :doc_type, :title, :filename, :mime_type,
             :file_size_bytes, :content_text, :source_url, :version, :effective_date)
        RETURNING id, compliance_item_id, doc_type, title, filename, mime_type,
                  file_size_bytes, source_url, ai_processed, version, effective_date, created_at
    """), {
        'compliance_item_id': body.compliance_item_id,
        'doc_type':           body.doc_type,
        'title':              body.title,
        'filename':           body.filename,
        'mime_type':          body.mime_type,
        'file_size_bytes':    file_size,
        'content_text':       content_text,
        'source_url':         body.source_url,
        'version':            body.version,
        'effective_date':     body.effective_date,
    })
    await db.commit()
    return dict(row.mappings().first())


@router.delete('/documents/{doc_id}', status_code=200)
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM twin.compliance_document WHERE id = :id"), {'id': doc_id})
    await db.commit()
    return {'deleted': doc_id}


# =============================================================
# Company compliance summary
# =============================================================

@router.get('/company/{company_id}/summary')
async def company_compliance_summary(company_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns a summary of all compliance obligations for a company —
    both global regulations and company-specific policies.
    """
    rows = await db.execute(text("""
        SELECT
            ci.id, ci.item_type, ci.name, ci.short_name, ci.status,
            ci.effective_date,
            count(DISTINCT cd.id)  FILTER (WHERE cd.valid_to IS NULL) AS dim_count,
            count(DISTINCT cim.id)                                     AS impact_count,
            max(cim.impact_level)                                      AS max_impact,
            count(DISTINCT cim.id) FILTER (WHERE cim.gap_status = 'open') AS open_gaps
        FROM twin.compliance_item ci
        LEFT JOIN twin.compliance_dimension cd  ON cd.compliance_item_id = ci.id
        LEFT JOIN twin.compliance_impact    cim ON cim.compliance_item_id = ci.id
                                               AND cim.company_id = :company_id
        WHERE ci.company_id = :company_id
           OR (ci.item_type = 'regulation' AND ci.company_id IS NULL)
        GROUP BY ci.id, ci.item_type, ci.name, ci.short_name, ci.status, ci.effective_date
        ORDER BY ci.item_type, ci.name
    """), {'company_id': company_id})
    return [_row_to_dict(r) for r in rows]
