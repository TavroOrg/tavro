# =============================================================
# api/routers/audit.py
# Compliance audit orchestration.
# Uses Claude API directly for each assessment agent.
# Streams progress via Server-Sent Events.
# =============================================================

import asyncio
import json
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db, engine as _shared_engine
from api.dependencies import require_tenant

router = APIRouter()
_background_tasks: set = set()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"
MAX_TOKENS        = int(os.getenv("AUDIT_MAX_TOKENS", "4096"))
MAX_SEARCH_TURNS  = int(os.getenv("AUDIT_MAX_TURNS",  "3"))


# =============================================================
# Schemas
# =============================================================

class AuditInitRequest(BaseModel):
    company_id:          str
    scope_type:          str     # single | use_case_all | catalog_single | full
    use_case_id:         str | None = None
    use_case_name:       str | None = None
    agent_id:            str | None = None
    agent_name:          str | None = None
    compliance_item_id:  str | None = None
    initiated_by:        str | None = None

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


async def _fetch_company(db: AsyncSession, company_id: str, tenant_id: str | None = None) -> dict | None:
    if tenant_id:
        r = await db.execute(
            text("SELECT * FROM twin.company WHERE id = :id AND tenant_id = :tid"),
            {"id": company_id, "tid": tenant_id},
        )
    else:
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


async def _fetch_compliance_dims(db: AsyncSession, item_id: str) -> list[dict]:
    rows = await db.execute(text("""
        SELECT cd.label, cd.summary, cdt.category
        FROM twin.compliance_dimension cd
        JOIN twin.compliance_dim_type cdt ON cdt.id = cd.dim_type_id
        WHERE cd.compliance_item_id = :id AND cd.valid_to IS NULL
        ORDER BY cdt.category, cd.label
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

Your task: Assess a specific AI use case or agent against a specific regulation or policy.
Return ONLY a JSON object. No markdown. No backticks. Start with {.

JSON structure:
{
  "risk_level": "critical|high|medium|low|none",
  "risk_score": 0-100,
  "confidence": 0-100,
  "applicable_rules": ["list of specific rules/requirements that apply to this use case"],
  "gaps": [
    {
      "requirement": "specific requirement",
      "current_state": "what exists today",
      "gap": "what is missing",
      "severity": "critical|high|medium|low"
    }
  ],
  "compliant_areas": ["list of requirements already met"],
  "recommendations": [
    {
      "action": "specific action to take",
      "priority": "immediate|short_term|long_term",
      "owner": "suggested responsible party"
    }
  ],
  "summary": "2-4 sentence narrative summary of the assessment"
}

Rules:
- Be specific to the actual use case and regulation, not generic
- risk_score: 0=no risk, 100=maximum risk
- confidence: 0=very uncertain, 100=highly confident
- Only include rules that genuinely apply to this use case
- Gaps must be actionable and specific"""


async def _run_assessment_agent(
    api_key:     str,
    use_case:    dict,
    comp_item:   dict,
    comp_dims:   list[dict],
    blueprint:   list[dict],
    company:     dict,
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

    prompt = f"""Assess this AI use case against this regulation/policy:

COMPANY: {company.get('name','Unknown')} | Industry: {company.get('industry','')} | Region: {company.get('region','')}

AI USE CASE:
{uc_text}

REGULATION/POLICY: {comp_item.get('name','')}
Type: {comp_item.get('item_type','')} | Issuing body: {comp_item.get('issuing_body','') or 'N/A'}
Description: {(comp_item.get('description') or '')[:400]}

KEY REQUIREMENTS:
{dim_text or '  (No structured dimensions — assess based on regulation name and description)'}

COMPANY BLUEPRINT (current capabilities):
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

            # Orchestrator fetches company without tenant check (already validated at request time)
            company    = await _fetch_company(db, request.company_id)
            blueprint  = await _fetch_blueprint_dims(db, request.company_id)
            comp_items = await _fetch_compliance_items(db, request.company_id, request.compliance_item_id)

            use_cases = []
            if request.use_case_id or request.agent_id:
                use_cases.append({
                    "identifier": request.use_case_id or request.agent_id,
                    "name":       request.use_case_name or request.agent_name or "Unknown",
                    "description": "",
                    "function":   "",
                    "status":     "active",
                })
            else:
                rows = await db.execute(text("""
                    SELECT DISTINCT use_case_id, use_case_name
                    FROM twin.audit_finding
                    WHERE company_id = :cid AND use_case_id IS NOT NULL
                    LIMIT 50
                """), {"cid": request.company_id})
                seen = {r.use_case_id for r in rows}
                if not seen:
                    use_cases.append({
                        "identifier": "catalog",
                        "name":       "Full AI Use Case Catalog",
                        "description": "Assessment across all registered AI use cases",
                        "status":     "active",
                    })
                else:
                    use_cases = [{"identifier": uid, "name": uname} for uid, uname in seen]

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
                        comp_dims = await _fetch_compliance_dims(db, str(ci["id"])) if ci.get("id") else []
                        result    = await _run_assessment_agent(api_key, uc, ci, comp_dims, blueprint, company or {})
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
                            "gaps":    json.dumps(result.get("gaps",[])),
                            "ca":      json.dumps(result.get("compliant_areas",[])),
                            "rec":     json.dumps(result.get("recommendations",[])),
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

            await db.execute(text("""
                UPDATE twin.audit_run SET
                    status='completed', overall_risk=:or_,
                    completed_pairs=:c, failed_pairs=:f,
                    completed_at=now(), updated_at=now()
                WHERE id=:id
            """), {"or_": overall, "c": completed, "f": failed, "id": audit_run_id})
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
async def initiate_audit(body: AuditInitRequest, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    if body.scope_type == "single" and not (body.use_case_id or body.agent_id):
        raise HTTPException(400, "scope_type=single requires use_case_id or agent_id")
    if body.scope_type in ("single","catalog_single") and not body.compliance_item_id:
        raise HTTPException(400, "This scope requires compliance_item_id")

    # Validate the company belongs to this tenant
    company = await _fetch_company(db, body.company_id, tenant_id)
    if not company:
        raise HTTPException(404, "Company not found")

    comp_items = await _fetch_compliance_items(db, body.company_id, body.compliance_item_id)
    if not comp_items:
        raise HTTPException(400, "No active compliance items found for this scope")

    uc_count = 1 if (body.use_case_id or body.agent_id) else max(1, 1)
    total    = uc_count * len(comp_items)

    ci_name = comp_items[0]["name"] if body.compliance_item_id and comp_items else None

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
        "ucname": body.use_case_name,
        "aid":    body.agent_id,
        "aname":  body.agent_name,
        "ciid":   body.compliance_item_id,
        "ciname": ci_name,
        "total":  total,
        "by":     body.initiated_by,
    })
    await db.commit()

    await db.close()

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
async def stream_audit_progress(run_id: str, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

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

            # Verify this run's company belongs to the calling tenant
            company_check = await db.execute(
                text("SELECT 1 FROM twin.company WHERE id = :cid AND tenant_id = :tid"),
                {"cid": run["company_id"], "tid": tenant_id},
            )
            if not company_check.scalar():
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
    tenant_id: str = Depends(require_tenant),
    limit:      int = Query(20),
    db: AsyncSession = Depends(get_db),
):

    # Validate the company belongs to this tenant
    company = await _fetch_company(db, company_id, tenant_id)
    if not company:
        raise HTTPException(404, "Company not found")

    rows = await db.execute(text("""
        SELECT ar.*,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id AND af.risk_level='critical') AS critical_count,
               (SELECT count(*) FROM twin.audit_finding af
                WHERE af.audit_run_id = ar.id AND af.risk_level='high') AS high_count
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
async def get_run(run_id: str, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    run_row = await db.execute(
        text("SELECT * FROM twin.audit_run WHERE id=:id"), {"id": run_id}
    )
    run = run_row.mappings().first()
    if not run: raise HTTPException(404, "Audit run not found")
    run_dict = dict(run)

    # Verify this run's company belongs to the calling tenant
    company = await _fetch_company(db, run_dict["company_id"], tenant_id)
    if not company:
        raise HTTPException(404, "Audit run not found")

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
async def cancel_run(run_id: str, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    run_row = await db.execute(
        text("SELECT company_id FROM twin.audit_run WHERE id=:id"), {"id": run_id}
    )
    run = run_row.mappings().first()
    if not run: raise HTTPException(404, "Audit run not found")

    company = await _fetch_company(db, run["company_id"], tenant_id)
    if not company:
        raise HTTPException(404, "Audit run not found")

    await db.execute(text("""
        UPDATE twin.audit_run SET status='cancelled', updated_at=now() WHERE id=:id
    """), {"id": run_id})
    await db.commit()
    return {"cancelled": run_id}


# =============================================================
# GET /audit/runs/{run_id}/findings/{finding_id}
# =============================================================

@router.get("/runs/{run_id}/findings/{finding_id}")
async def get_finding(run_id: str, finding_id: str, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    row = await db.execute(text("""
        SELECT af.* FROM twin.audit_finding af
        JOIN twin.audit_run ar ON ar.id = af.audit_run_id
        JOIN twin.company c ON c.id = ar.company_id AND c.tenant_id = :tid
        WHERE af.id=:fid AND af.audit_run_id=:rid
    """), {"fid": finding_id, "rid": run_id, "tid": tenant_id})
    finding = row.mappings().first()
    if not finding: raise HTTPException(404, "Finding not found")
    return dict(finding)
