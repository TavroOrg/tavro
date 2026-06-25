# =============================================================
# api/routers/audit.py
# Compliance audit orchestration.
# Uses Claude API directly for each assessment agent.
# Streams progress via Server-Sent Events.
# =============================================================

import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db, engine as _shared_engine

router = APIRouter()
_background_tasks: set = set()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"
MAX_TOKENS        = int(os.getenv("AUDIT_MAX_TOKENS", "4096"))
MAX_SEARCH_TURNS  = int(os.getenv("AUDIT_MAX_TURNS",  "3"))
CORE              = os.getenv("CORE_DB_NAME", "core")


# =============================================================
# Schemas
# =============================================================

class AuditInitRequest(BaseModel):
    company_id:            str
    scope_type:            str     # single | use_case_all | catalog_single | full
    use_case_id:           str | None = None
    use_case_name:         str | None = None
    agent_id:              str | None = None
    agent_name:            str | None = None
    compliance_item_id:    str | None = None
    use_case_ids:          list[str] | None = None   # multi-select: specific use cases
    compliance_item_ids:   list[str] | None = None   # multi-select: specific regulations
    initiated_by:          str | None = None

class AuditRunResponse(BaseModel):
    audit_run_id: str
    status:       str
    total_pairs:  int
    message:      str


# =============================================================
# Helpers
# =============================================================

def _row(r) -> dict:
    if r is None:
        return {}
    try:
        return dict(r._mapping)
    except AttributeError:
        return dict(r)


async def _fetch_company(db: AsyncSession, company_id: str) -> dict | None:
    r = await db.execute(
        text("SELECT * FROM twin.company WHERE id = :id"), {"id": company_id}
    )
    row = r.mappings().first()
    return dict(row) if row else None


async def _fetch_blueprint_dims(db: AsyncSession, company_id: str) -> list[dict]:
    rows = await db.execute(text("""
        SELECT n.label, t.category, n.summary
        FROM twin.dim_node n
        JOIN twin.dim_type t ON t.id = n.dim_type_id
        WHERE n.company_id = :cid AND n.valid_to IS NULL
        ORDER BY t.category, n.label LIMIT 30
    """), {"cid": company_id})
    return [dict(r._mapping) for r in rows]


async def _fetch_compliance_items(
    db: AsyncSession,
    company_id: str,
    item_id: str | None = None,
) -> list[dict]:
    if item_id:
        rows = await db.execute(
            text("SELECT * FROM twin.compliance_item WHERE id = :id"), {"id": item_id}
        )
    else:
        rows = await db.execute(text("""
            SELECT ci.*,
                   (SELECT string_agg(cd.label || ': ' || coalesce(cd.summary,''), ' | ')
                    FROM twin.compliance_dimension cd
                    WHERE cd.compliance_item_id = ci.id AND cd.valid_to IS NULL
                    LIMIT 8) AS dim_summary
            FROM twin.compliance_item ci
            WHERE ci.status = 'active'
              AND (ci.item_type = 'regulation' OR ci.company_id = :cid)
            ORDER BY ci.item_type, ci.name
        """), {"cid": company_id})
    return [dict(r._mapping) for r in rows]


def _in_params(ids: list[str], prefix: str) -> tuple[str, dict]:
    """Return (SQL IN clause, params dict) for a list of IDs."""
    placeholders = ', '.join(f':{prefix}_{i}' for i in range(len(ids)))
    params = {f'{prefix}_{i}': id_ for i, id_ in enumerate(ids)}
    return f'({placeholders})', params


async def _fetch_compliance_items_by_ids(db: AsyncSession, ids: list[str]) -> list[dict]:
    if not ids:
        return []
    in_clause, params = _in_params(ids, 'ci')
    rows = await db.execute(text(f"""
        SELECT ci.*,
               (SELECT string_agg(cd.label || ': ' || coalesce(cd.summary,''), ' | ')
                FROM twin.compliance_dimension cd
                WHERE cd.compliance_item_id = ci.id AND cd.valid_to IS NULL
                LIMIT 8) AS dim_summary
        FROM twin.compliance_item ci
        WHERE ci.id IN {in_clause}
        ORDER BY ci.item_type, ci.name
    """), params)
    return [dict(r._mapping) for r in rows]


async def _fetch_compliance_dims(db: AsyncSession, item_id: str) -> list[dict]:
    rows = await db.execute(text("""
        SELECT cd.label, cd.summary, cdt.category
        FROM twin.compliance_dimension cd
        JOIN twin.compliance_dim_type cdt ON cdt.id = cd.dim_type_id
        WHERE cd.compliance_item_id = :id AND cd.valid_to IS NULL
        ORDER BY cdt.category, cd.label
    """), {"id": item_id})
    return [dict(r._mapping) for r in rows]


async def _fetch_compliance_documents(db: AsyncSession, item_id: str) -> list[dict]:
    """Fetch uploaded/linked documents for a compliance item from the compliance library."""
    rows = await db.execute(text("""
        SELECT title, doc_type, ai_summary, ai_key_points, content_text, source_url
        FROM twin.compliance_document
        WHERE compliance_item_id = :id
          AND (
                (content_text IS NOT NULL AND length(content_text) > 50)
                OR ai_summary IS NOT NULL
              )
        ORDER BY
            CASE doc_type
                WHEN 'policy_text' THEN 0
                WHEN 'source'      THEN 1
                WHEN 'guidance'    THEN 2
                WHEN 'summary'     THEN 3
                ELSE 4
            END
        LIMIT 4
    """), {"id": item_id})
    return [dict(r._mapping) for r in rows]


def _extract_json(raw: str) -> str:
    fenced = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', raw)
    if fenced:
        return fenced.group(1).strip()
    start = raw.find('{')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0: return raw[start:i+1]
    return raw.strip()


# =============================================================
# Core assessment agent — one use case × one regulation
# =============================================================

ASSESSMENT_SYSTEM = """You are a Compliance Risk Assessment Agent for an enterprise AI governance platform.

Your task: Assess a specific AI use case against a specific regulation or policy.
Return ONLY a JSON object. No markdown. No backticks. Start with {.

JSON structure:
{
  "risk_level": "critical|high|medium|low",
  "risk_score": 1-100,
  "confidence": 1-100,
  "applicable_rules": ["specific rule or article identifiers from THIS regulation that apply"],
  "specific": {
    "gaps": [
      {
        "requirement": "exact requirement from this regulation",
        "current_state": "what exists today",
        "gap": "what is missing to satisfy this specific requirement",
        "severity": "critical|high|medium|low"
      }
    ],
    "compliant_areas": ["requirements of this regulation already satisfied"],
    "recommendations": [
      {
        "action": "concrete action to satisfy this regulation's requirement",
        "priority": "immediate|short_term|long_term",
        "owner": "suggested responsible party"
      }
    ]
  },
  "generic": {
    "gaps": [
      {
        "requirement": "general AI governance principle",
        "current_state": "what exists today",
        "gap": "what is missing for sound AI governance",
        "severity": "critical|high|medium|low"
      }
    ],
    "compliant_areas": ["general AI governance controls already in place"],
    "recommendations": [
      {
        "action": "action to improve general AI governance posture",
        "priority": "immediate|short_term|long_term",
        "owner": "suggested responsible party"
      }
    ]
  },
  "summary": "2-4 sentence narrative covering both regulation-specific and general governance findings"
}

Rules:
- specific: findings that reference EXPLICIT requirements of this regulation/policy for this use case
- generic: cross-cutting AI governance concerns (model documentation, bias testing, drift monitoring, explainability, incident response) that apply regardless of which regulation is evaluated
- risk_score: 1=minimal risk, 100=maximum risk (always between 1 and 100, never 0)
- confidence: 1=very uncertain, 100=highly confident (always between 1 and 100, never 0)
- risk_level must align with risk_score: 1-25=low, 26-50=medium, 51-75=high, 76-100=critical
- applicable_rules: cite specific article/section identifiers, not paraphrases
- Every gap must be actionable; every recommendation must name a concrete owner"""


async def _run_assessment_agent(
    api_key:               str,
    use_case:              dict,
    comp_item:             dict,
    comp_dims:             list[dict],
    blueprint:             list[dict],
    company:               dict,
    compliance_documents:  list[dict] | None = None,
) -> dict:
    t0 = time.time()

    bp_text = "\n".join(
        f"  [{d['category']}] {d['label']}: {(d.get('summary') or '')[:120]}"
        for d in blueprint[:20]
    )
    dim_text = "\n".join(
        f"  [{d['category']}] {d['label']}: {(d.get('summary') or '')[:200]}"
        for d in comp_dims[:15]
    )
    uc_text = json.dumps({
        k: v for k, v in use_case.items()
        if k in ('name','description','status','function','identifier') and v
    }, ensure_ascii=False)

    from services.audit_agents.audit_assessment import _build_doc_section
    research_notes = comp_item.get("ai_research_notes") or ""
    research_section = (
        f"\n\nCOMPLIANCE RESEARCH NOTES:\n{research_notes[:800]}"
        if research_notes else ""
    )
    doc_section = _build_doc_section(compliance_documents or [])

    prompt = f"""Assess this AI use case against this regulation/policy:

COMPANY: {company.get('name','Unknown')} | Industry: {company.get('industry','')} | Region: {company.get('region','')}

AI USE CASE:
{uc_text}

REGULATION/POLICY: {comp_item.get('name','')}
Type: {comp_item.get('item_type','')} | Issuing body: {comp_item.get('issuing_body','') or 'N/A'}
Jurisdiction: {', '.join(comp_item.get('jurisdiction') or []) or 'N/A'}
Description: {(comp_item.get('description') or '')[:400]}{research_section}{doc_section}

KEY REQUIREMENTS (structured dimensions from compliance library):
{dim_text or '  (No structured dimensions — assess based on regulation name, description, and documents above)'}

COMPANY BLUEPRINT (current AI governance capabilities):
{bp_text or '  (No blueprint dimensions available)'}

Return ONLY the JSON assessment object."""

    messages = [{"role": "user", "content": prompt}]
    session_id = str(uuid.uuid4())

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={
                "model": ANTHROPIC_MODEL, "max_tokens": MAX_TOKENS,
                "system": ASSESSMENT_SYSTEM, "messages": messages,
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"API {resp.status_code}: {resp.text[:200]}")

    data    = resp.json()
    raw     = "\n".join(b["text"] for b in data.get("content",[]) if b.get("type")=="text").strip()
    tokens  = data.get("usage",{}).get("input_tokens",0) + data.get("usage",{}).get("output_tokens",0)
    elapsed = int((time.time() - t0) * 1000)

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*","",raw); raw = re.sub(r"\s*```$","",raw).strip()
    try:
        parsed = json.loads(_extract_json(raw))
    except json.JSONDecodeError:
        parsed = {
            "risk_level": "medium", "risk_score": 50, "confidence": 20,
            "applicable_rules": [], "gaps": [], "compliant_areas": [],
            "recommendations": [],
            "summary": f"Assessment could not be fully parsed. Raw: {raw[:200]}"
        }

    parsed["_session_id"]  = session_id
    parsed["_tokens"]      = tokens
    parsed["_duration_ms"] = elapsed
    return parsed


# =============================================================
# Orchestrator
# =============================================================

async def _run_orchestrator(
    audit_run_id: str,
    request:      AuditInitRequest,
) -> None:
    from sqlalchemy.ext.asyncio import AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(_shared_engine, class_=AS, expire_on_commit=False)
    api_key = os.getenv("ANTHROPIC_API_KEY", "")

    async with Session() as db:
        try:
            await db.execute(text(
                "UPDATE twin.audit_run SET status='running', updated_at=now() WHERE id=:id"
            ), {"id": audit_run_id})
            await db.commit()

            company   = await _fetch_company(db, request.company_id)
            blueprint = await _fetch_blueprint_dims(db, request.company_id)

            # ── Resolve compliance items ───────────────────────────────────
            if request.compliance_item_ids:
                comp_items = await _fetch_compliance_items_by_ids(db, request.compliance_item_ids)
            else:
                comp_items = await _fetch_compliance_items(db, request.company_id, request.compliance_item_id)

            # ── Resolve use cases ──────────────────────────────────────────
            use_cases = []
            if request.use_case_ids:
                in_clause, in_params = _in_params(request.use_case_ids, 'ucid')
                rows = await db.execute(text(f"""
                    SELECT ai_use_case_id AS identifier, name, description
                    FROM {CORE}.ai_use_cases
                    WHERE ai_use_case_id IN {in_clause}
                    ORDER BY name
                """), in_params)
                use_cases = [
                    {
                        "identifier":  r["identifier"],
                        "name":        r["name"] or r["identifier"],
                        "description": r.get("description") or "",
                        "status":      "active",
                    }
                    for r in rows.mappings()
                ]
            elif request.use_case_id or request.agent_id:
                use_cases.append({
                    "identifier":  request.use_case_id or request.agent_id,
                    "name":        request.use_case_name or request.agent_name or "Unknown",
                    "description": "",
                    "status":      "active",
                })
            else:
                rows = await db.execute(text(f"""
                    SELECT ai_use_case_id AS identifier, name, description
                    FROM {CORE}.ai_use_cases
                    WHERE CAST(company_id AS text) = :cid
                      AND ai_use_case_id IS NOT NULL AND ai_use_case_id <> ''
                    ORDER BY name
                    LIMIT 100
                """), {"cid": request.company_id})
                use_cases = [
                    {
                        "identifier":  r["identifier"],
                        "name":        r["name"] or r["identifier"],
                        "description": r.get("description") or "",
                        "status":      "active",
                    }
                    for r in rows.mappings()
                ]
                if not use_cases:
                    raise Exception("No AI use cases found for this company.")

            total = len(use_cases) * len(comp_items)
            await db.execute(text(
                "UPDATE twin.audit_run SET total_pairs=:n WHERE id=:id"
            ), {"n": total, "id": audit_run_id})
            await db.commit()

            completed = 0
            failed    = 0

            for uc in use_cases:
                for ci in comp_items:
                    finding_id = str(uuid.uuid4())
                    await db.execute(text("""
                        INSERT INTO twin.audit_finding
                            (id, audit_run_id, company_id, use_case_id, use_case_name,
                             compliance_item_id, compliance_item_name, compliance_item_type, status)
                        VALUES
                            (:fid, :rid, :cid, :ucid, :ucname, :ciid, :ciname, :citype, 'running')
                    """), {
                        "fid":    finding_id,
                        "rid":    audit_run_id,
                        "cid":    request.company_id,
                        "ucid":   uc.get("identifier",""),
                        "ucname": uc.get("name",""),
                        "ciid":   str(ci["id"]) if ci.get("id") else None,
                        "ciname": ci.get("name",""),
                        "citype": ci.get("item_type","regulation"),
                    })
                    await db.commit()

                    try:
                        ci_id     = str(ci["id"]) if ci.get("id") else None
                        comp_dims = await _fetch_compliance_dims(db, ci_id) if ci_id else []
                        comp_docs = await _fetch_compliance_documents(db, ci_id) if ci_id else []
                        result    = await _run_assessment_agent(
                            api_key, uc, ci, comp_dims, blueprint, company or {},
                            compliance_documents=comp_docs,
                        )
                        await db.execute(text("""
                            UPDATE twin.audit_finding SET
                                status='completed',
                                risk_level=:rl, risk_score=:rs, confidence=:conf,
                                applicable_rules=cast(:ar as jsonb),
                                gaps=cast(:gaps as jsonb),
                                compliant_areas=cast(:ca as jsonb),
                                recommendations=cast(:rec as jsonb),
                                summary=:summary,
                                agent_session_id=:sid,
                                tokens_used=:tok,
                                assessment_duration_ms=:dur,
                                updated_at=now()
                            WHERE id=:fid
                        """), {
                            "fid":     finding_id,
                            "rl":      result.get("risk_level","medium"),
                            "rs":      result.get("risk_score",50),
                            "conf":    result.get("confidence",50),
                            "ar":      json.dumps(result.get("applicable_rules",[])),
                            "gaps":    json.dumps({
                                "specific": result.get("specific",{}).get("gaps",[]),
                                "generic":  result.get("generic",{}).get("gaps",[]),
                            }),
                            "ca":      json.dumps({
                                "specific": result.get("specific",{}).get("compliant_areas",[]),
                                "generic":  result.get("generic",{}).get("compliant_areas",[]),
                            }),
                            "rec":     json.dumps({
                                "specific": result.get("specific",{}).get("recommendations",[]),
                                "generic":  result.get("generic",{}).get("recommendations",[]),
                            }),
                            "summary": result.get("summary",""),
                            "sid":     result.get("_session_id",""),
                            "tok":     result.get("_tokens",0),
                            "dur":     result.get("_duration_ms",0),
                        })
                        completed += 1
                    except Exception as e:
                        await db.execute(text("""
                            UPDATE twin.audit_finding SET
                                status='failed', error_message=:err, updated_at=now()
                            WHERE id=:fid
                        """), {"fid": finding_id, "err": str(e)[:500]})
                        failed += 1

                    await db.execute(text("""
                        UPDATE twin.audit_run SET
                            completed_pairs=:c, failed_pairs=:f, updated_at=now()
                        WHERE id=:id
                    """), {"c": completed, "f": failed, "id": audit_run_id})
                    await db.commit()

            risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
            risk_rows = await db.execute(text("""
                SELECT risk_level FROM twin.audit_finding
                WHERE audit_run_id=:rid AND status='completed' AND risk_level IS NOT NULL
            """), {"rid": audit_run_id})
            risks   = [r['risk_level'] for r in risk_rows.mappings() if r['risk_level']]
            overall = min(risks, key=lambda x: risk_order.get(x, 99)) if risks else None

            final_status = 'failed' if failed > 0 else 'completed'
            await db.execute(text("""
                UPDATE twin.audit_run SET
                    status=:status, overall_risk=:or_,
                    completed_pairs=:c, failed_pairs=:f,
                    completed_at=now(), updated_at=now()
                WHERE id=:id
            """), {"status": final_status, "or_": overall, "c": completed, "f": failed, "id": audit_run_id})
            await db.commit()

        except Exception as e:
            await db.execute(text("""
                UPDATE twin.audit_run SET
                    status='failed', error_message=:err, updated_at=now()
                WHERE id=:id
            """), {"id": audit_run_id, "err": str(e)[:500]})
            await db.commit()


# =============================================================
# POST /audit/runs — initiate an audit
# =============================================================

@router.post("/runs", response_model=AuditRunResponse, status_code=202)
async def initiate_audit(body: AuditInitRequest, db: AsyncSession = Depends(get_db)):
    # ── Resolve compliance items ───────────────────────────────────────────────
    if body.compliance_item_ids:
        comp_items = await _fetch_compliance_items_by_ids(db, body.compliance_item_ids)
    else:
        comp_items = await _fetch_compliance_items(db, body.company_id, body.compliance_item_id)
    if not comp_items:
        raise HTTPException(400, "No active compliance items found for this scope")

    # ── Resolve use case count ─────────────────────────────────────────────────
    if body.use_case_ids:
        uc_count = len(body.use_case_ids)
    elif body.use_case_id or body.agent_id:
        uc_count = 1
    else:
        uc_rows = await db.execute(text(f"""
            SELECT COUNT(*) AS cnt FROM {CORE}.ai_use_cases
            WHERE CAST(company_id AS text) = :cid
              AND ai_use_case_id IS NOT NULL AND ai_use_case_id <> ''
        """), {"cid": body.company_id})
        uc_count = int((uc_rows.mappings().first() or {}).get("cnt", 0))
        if uc_count == 0:
            raise HTTPException(400, "No AI use cases found for this company. Add use cases before running a catalog-wide audit.")

    total = uc_count * len(comp_items)

    # For display names shown in audit cards
    if body.compliance_item_ids:
        labels = [item.get("short_name") or item["name"] for item in comp_items]
        ci_name = ", ".join(labels)
    elif len(comp_items) == 1:
        ci_name = comp_items[0].get("short_name") or comp_items[0]["name"]
    else:
        ci_name = None

    if body.use_case_ids:
        in_clause, in_params = _in_params(body.use_case_ids, 'ucn')
        uc_rows = await db.execute(text(f"""
            SELECT ai_use_case_id, name FROM {CORE}.ai_use_cases
            WHERE ai_use_case_id IN {in_clause}
        """), in_params)
        uc_names = [r["name"] or r["ai_use_case_id"] for r in uc_rows.mappings()]
        uc_name = ", ".join(uc_names) if uc_names else None
    elif body.use_case_id:
        uc_name = body.use_case_name
    else:
        uc_name = None

    run_id = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO twin.audit_run
            (id, company_id, scope_type, use_case_id, use_case_name,
             agent_id, agent_name, compliance_item_id, compliance_item_name,
             status, total_pairs, initiated_by)
        VALUES
            (:id, :cid, :scope, :ucid, :ucname,
             :aid, :aname, :ciid, :ciname,
             'pending', :total, :by)
    """), {
        "id":     run_id,
        "cid":    body.company_id,
        "scope":  body.scope_type,
        "ucid":   body.use_case_id,
        "ucname": uc_name,
        "aid":    body.agent_id,
        "aname":  body.agent_name,
        "ciid":   comp_items[0]["id"] if len(comp_items) == 1 else None,
        "ciname": ci_name,
        "total":  total,
        "by":     body.initiated_by,
    })
    await db.commit()

    await db.close()

    # ── Launch via Temporal (durable, observable) ─────────────────────────
    try:
        from temporalio.client import Client as TemporalClient
        from services.workflow.audit_workflow import AuditWorkflow
        from services.workflow.params import AuditWorkflowParams

        tc = await TemporalClient.connect(
            os.getenv("TEMPORAL_ADDRESS", "risk-temporal:7233")
        )
        await tc.start_workflow(
            AuditWorkflow.run,
            AuditWorkflowParams(
                audit_run_id        = run_id,
                company_id          = body.company_id,
                scope_type          = body.scope_type,
                use_case_id         = body.use_case_id,
                use_case_name       = body.use_case_name,
                agent_id            = body.agent_id,
                agent_name          = body.agent_name,
                compliance_item_id  = body.compliance_item_id,
                use_case_ids        = body.use_case_ids or [],
                compliance_item_ids = body.compliance_item_ids or [],
                initiated_by        = body.initiated_by,
            ),
            id=f"audit-{run_id}",
            task_queue="audit-assessment-queue",
        )
    except Exception as _te:
        logger.warning("Temporal unavailable (%s) — falling back to in-process runner", _te)
        task = asyncio.create_task(_run_orchestrator(run_id, body))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    return AuditRunResponse(
        audit_run_id=run_id,
        status="pending",
        total_pairs=total,
        message=f"Audit initiated — {total} assessment{'s' if total != 1 else ''} queued",
    )


# =============================================================
# GET /audit/runs/{run_id}/stream — SSE progress stream
# =============================================================

@router.get("/runs/{run_id}/stream")
async def stream_audit_progress(run_id: str, db: AsyncSession = Depends(get_db)):

    async def generate() -> AsyncGenerator[str, None]:
        seen_finding_ids: set[str] = set()
        max_polls = 300

        for _ in range(max_polls):
            run_row = await db.execute(
                text("SELECT * FROM twin.audit_run WHERE id=:id"), {"id": run_id}
            )
            run = run_row.mappings().first()
            if not run:
                yield f"data: {json.dumps({'type':'error','message':'Audit run not found'})}\n\n"
                return

            new_findings_q = await db.execute(text("""
                SELECT id, use_case_name, compliance_item_name, compliance_item_type,
                       status, risk_level, risk_score, summary, error_message,
                       tokens_used, assessment_duration_ms, updated_at
                FROM twin.audit_finding
                WHERE audit_run_id=:rid
                ORDER BY updated_at ASC
            """), {"rid": run_id})
            all_findings = [dict(r) for r in new_findings_q.mappings()]

            for f in all_findings:
                fid = str(f["id"])
                if fid not in seen_finding_ids and f["status"] in ("completed","failed"):
                    seen_finding_ids.add(fid)
                    yield f"data: {json.dumps({'type':'finding', 'finding': {**f, 'id': fid, 'updated_at': str(f['updated_at'])}})}\n\n"

            progress_pct = (
                int(run["completed_pairs"] / run["total_pairs"] * 100)
                if run["total_pairs"] > 0 else 0
            )
            yield f"data: {json.dumps({'type':'progress','status':run['status'],'completed':run['completed_pairs'],'failed':run['failed_pairs'],'total':run['total_pairs'],'pct':progress_pct,'overall_risk':run['overall_risk']})}\n\n"

            if run["status"] in ("completed", "failed", "cancelled"):
                yield f"data: {json.dumps({'type':'done','status':run['status'],'overall_risk':run['overall_risk'],'summary':run['summary_text']})}\n\n"
                return

            await db.commit()
            await asyncio.sleep(1.5)

        yield f"data: {json.dumps({'type':'timeout'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# =============================================================
# GET /audit/runs
# =============================================================

@router.get("/runs")
async def list_runs(
    company_id: str = Query(...),
    limit:      int = Query(20),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(text("""
        SELECT ar.*,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id
                  AND CASE WHEN af.risk_level <> 'none' THEN af.risk_level
                           WHEN af.risk_score >= 76 THEN 'critical'
                           WHEN af.risk_score >= 51 THEN 'high'
                           WHEN af.risk_score >= 26 THEN 'medium'
                           ELSE 'low' END = 'critical') AS critical_count,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id
                  AND CASE WHEN af.risk_level <> 'none' THEN af.risk_level
                           WHEN af.risk_score >= 76 THEN 'critical'
                           WHEN af.risk_score >= 51 THEN 'high'
                           WHEN af.risk_score >= 26 THEN 'medium'
                           ELSE 'low' END = 'high') AS high_count,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id
                  AND CASE WHEN af.risk_level <> 'none' THEN af.risk_level
                           WHEN af.risk_score >= 76 THEN 'critical'
                           WHEN af.risk_score >= 51 THEN 'high'
                           WHEN af.risk_score >= 26 THEN 'medium'
                           ELSE 'low' END = 'medium') AS medium_count,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id
                  AND CASE WHEN af.risk_level <> 'none' THEN af.risk_level
                           WHEN af.risk_score >= 76 THEN 'critical'
                           WHEN af.risk_score >= 51 THEN 'high'
                           WHEN af.risk_score >= 26 THEN 'medium'
                           ELSE 'low' END = 'low') AS low_count,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id AND af.risk_level='none'
                  AND (af.risk_score IS NULL OR af.risk_score = 0)) AS none_count
        FROM twin.audit_run ar
        WHERE ar.company_id=:cid
        ORDER BY ar.created_at DESC
        LIMIT :lim
    """), {"cid": company_id, "lim": limit})
    return [dict(r) for r in rows.mappings()]


# =============================================================
# GET /audit/runs/{run_id}
# =============================================================

@router.get("/runs/{run_id}")
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run_row = await db.execute(
        text("SELECT * FROM twin.audit_run WHERE id=:id"), {"id": run_id}
    )
    run = run_row.mappings().first()
    if not run: raise HTTPException(404, "Audit run not found")
    run_dict = dict(run)

    findings_rows = await db.execute(text("""
        SELECT * FROM twin.audit_finding
        WHERE audit_run_id=:rid ORDER BY risk_score DESC NULLS LAST
    """), {"rid": run_id})
    findings = [dict(r) for r in findings_rows.mappings()]

    return {**run_dict, "findings": findings}


# =============================================================
# DELETE /audit/runs/{run_id}
# =============================================================

@router.delete("/runs/{run_id}", status_code=200)
async def cancel_run(run_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(text("""
        UPDATE twin.audit_run SET status='cancelled', updated_at=now() WHERE id=:id
    """), {"id": run_id})
    await db.commit()
    return {"cancelled": run_id}


# =============================================================
# GET /audit/runs/{run_id}/findings/{finding_id}
# =============================================================

@router.get("/runs/{run_id}/findings/{finding_id}")
async def get_finding(run_id: str, finding_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.execute(text("""
        SELECT * FROM twin.audit_finding
        WHERE id=:fid AND audit_run_id=:rid
    """), {"fid": finding_id, "rid": run_id})
    finding = row.mappings().first()
    if not finding: raise HTTPException(404, "Finding not found")
    return dict(finding)
