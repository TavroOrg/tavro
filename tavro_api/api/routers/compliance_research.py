# =============================================================
# api/routers/compliance_research.py
# AI-powered research for regulations and policies.
# =============================================================

import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.dependencies import require_tenant
from api.llm import (
    _resolve_compliance_llm,
    _call_anthropic,
    _call_openai,
    _collect_text,
    _extract_json,
)

router = APIRouter()

# ── In-memory job store ───────────────────────────────────────────────────────

@dataclass
class _Job:
    status: str = "pending"   # pending | done | error
    result: Optional[dict] = None
    error:  Optional[str]  = None

_jobs: dict[str, _Job] = {}

MAX_OUTPUT_TOKENS      = int(os.getenv("RESEARCH_MAX_OUTPUT_TOKENS",     "4096"))
MAX_SEARCH_TURNS       = int(os.getenv("RESEARCH_MAX_SEARCH_TURNS",      "3"))
MAX_JSON_CONTINUATIONS = int(os.getenv("RESEARCH_MAX_JSON_CONTINUATIONS", "3"))


# =============================================================
# Schemas
# =============================================================

class RegResearchRequest(BaseModel):
    name:          str
    short_name:    str | None = None
    issuing_body:  str | None = None
    jurisdiction:  list[str] = []
    industry_tags: list[str] = []

class PolicyResearchRequest(BaseModel):
    name:        str
    company_id:  str
    description: str | None = None
    doc_text:    str | None = None   # extracted text from uploaded document

class ResearchedDimension(BaseModel):
    category:   str
    label:      str
    summary:    str
    tags:       list[str] = []

class ResearchResponse(BaseModel):
    dimensions:  list[ResearchedDimension]
    sources:     list[str]
    notice:      str
    turns_used:  int


# =============================================================
# Research helpers
# =============================================================

def _collect_tool_results(data: dict) -> list[dict]:
    return [
        {"type": "tool_result", "tool_use_id": b["id"], "content": "Search done. Return JSON now."}
        for b in data.get("content", []) if b.get("type") == "tool_use"
    ]


async def _run_research(
    provider: str,
    api_key: str,
    system:  str,
    user_prompt: str,
) -> tuple[list[ResearchedDimension], list[str], str, int]:
    """Run multi-turn research and return (dimensions, sources, notice, turns_used)."""
    messages = [{"role": "user", "content": user_prompt}]
    tools    = [{"type": "web_search_20250305", "name": "web_search"}] if provider == "anthropic" else None

    if provider == "openai":
        data = await _call_openai(api_key, messages, system, MAX_OUTPUT_TOKENS)
    else:
        data = await _call_anthropic(api_key, messages, system, tools)
    turns = 0

    for _ in range(MAX_SEARCH_TURNS if provider == "anthropic" else 0):
        if data.get("stop_reason") != "tool_use": break
        trs = _collect_tool_results(data)
        if not trs: break
        turns += 1
        messages.append({"role": "assistant", "content": data["content"]})
        messages.append({"role": "user",      "content": trs})
        data = await _call_anthropic(api_key, messages, system, tools)

    # Force answer if still tool_use after cap
    if provider == "anthropic" and data.get("stop_reason") == "tool_use":
        trs = _collect_tool_results(data)
        if trs:
            messages.append({"role": "assistant", "content": data["content"]})
            messages.append({"role": "user", "content": [{**tr, "content": "Search limit reached. Return JSON now."} for tr in trs]})
            data = await _call_anthropic(api_key, messages, system, tools=None)

    raw = _collect_text(data).strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "",        raw).strip()
    raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", raw)

    # Truncation recovery
    if data.get("stop_reason") == "max_tokens":
        for _ in range(MAX_JSON_CONTINUATIONS):
            try:
                json.loads(_extract_json(raw), strict=False)
                break
            except json.JSONDecodeError:
                messages.append({"role": "assistant", "content": raw})
                messages.append({
                    "role": "user",
                    "content": (
                        "Your previous JSON was truncated. Continue exactly from where it ended "
                        "and finish the same JSON object. Return only raw JSON continuation text."
                    ),
                })
                if provider == "openai":
                    cont = await _call_openai(api_key, messages, system, MAX_OUTPUT_TOKENS)
                else:
                    cont = await _call_anthropic(api_key, messages, system, tools=None)
                cont_text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", _collect_text(cont).strip())
                if not cont_text:
                    break
                raw = raw + cont_text
                if cont.get("stop_reason") != "max_tokens":
                    break

    try:
        parsed = json.loads(_extract_json(raw), strict=False)
    except json.JSONDecodeError:
        repair_system = (
            "You are a JSON formatter. Convert the user's input into strictly valid JSON. "
            "Return only one JSON object. No markdown, no commentary, no backticks."
        )
        repair_prompt = (
            "The following output is intended to be JSON but is malformed. "
            "Fix it into valid JSON with the same schema and content as much as possible.\n\n"
            f"{raw}"
        )
        if provider == "openai":
            repaired_data = await _call_openai(api_key, [{"role": "user", "content": repair_prompt}], repair_system, MAX_OUTPUT_TOKENS)
        else:
            repaired_data = await _call_anthropic(api_key, [{"role": "user", "content": repair_prompt}], repair_system, tools=None, max_tokens=MAX_OUTPUT_TOKENS)
        repaired_raw = _collect_text(repaired_data).strip()
        if repaired_raw.startswith("```"):
            repaired_raw = re.sub(r"^```(?:json)?\s*", "", repaired_raw)
            repaired_raw = re.sub(r"\s*```$", "", repaired_raw).strip()
        repaired_raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", repaired_raw)
        try:
            parsed = json.loads(_extract_json(repaired_raw), strict=False)
        except json.JSONDecodeError as e2:
            raise HTTPException(502, f"JSON parse error: {str(e2)[:200]}")

    dims    = [ResearchedDimension(**d) for d in parsed.get("dimensions", [])]
    sources = parsed.get("sources", [])
    notice  = parsed.get("notice", "AI-generated — please verify before use.")
    return dims, sources, notice, turns


# =============================================================
# System prompts
# =============================================================

REG_RESEARCH_SYSTEM = """You are a regulatory compliance expert AI. Research the given regulation
and return ONLY a JSON object (no markdown, no fences, start with {) with this structure:

{
  "dimensions": [
    {
      "category": "scope|requirement|deadline|penalty|control|audit|impact",
      "label": "concise label",
      "summary": "2-4 sentence plain text explanation",
      "tags": ["lowercase-hyphenated", "tags"]
    }
  ],
  "sources": ["list of sources consulted"],
  "notice": "one sentence noting this is AI-generated from public sources"
}

Categories to cover:
- "scope": 1-2 nodes — who and what this regulation applies to
- "requirement": 3-6 nodes — key obligations and prohibited activities
- "control": 2-4 nodes — required internal controls and processes
- "deadline": 1-3 nodes — compliance deadlines and reporting frequencies
- "penalty": 1-2 nodes — enforcement actions and penalties for non-compliance
- "audit": 1-3 nodes — examination, audit, and reporting requirements

Rules:
- Use publicly available official sources
- Be specific with numbers, dates, thresholds where available
- Tags: lowercase, hyphen-separated, max 6 per dimension
- Return ONLY the JSON. No other text. No backticks."""


POLICY_RESEARCH_SYSTEM = """You are a corporate compliance and policy expert AI.
Analyse the given policy information and return ONLY a JSON object with this structure:

{
  "dimensions": [
    {
      "category": "scope|requirement|control|deadline|audit|impact|custom",
      "label": "concise label",
      "summary": "2-4 sentence plain text explanation",
      "tags": ["lowercase-hyphenated", "tags"]
    }
  ],
  "sources": ["Policy document", "Company standards"],
  "notice": "one sentence noting this is AI-generated and should be reviewed"
}

Categories to cover:
- "scope": 1 node — who this policy applies to
- "requirement": 2-4 nodes — key requirements and obligations
- "control": 2-3 nodes — required controls and implementation steps
- "audit": 1-2 nodes — audit and compliance verification requirements
- "impact": 1-2 nodes (MANDATORY) — business impact if policy is violated
- "deadline": 0-2 nodes — review cycles and compliance deadlines

Return ONLY the JSON. No other text."""


# =============================================================
# GET /research/job/{job_id}
# =============================================================

@router.get("/research/job/{job_id}")
async def get_research_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"status": job.status, "result": job.result, "error": job.error}


# =============================================================
# POST /research/regulation
# =============================================================

async def _bg_regulation_research(job_id: str, provider: str, api_key: str, body: RegResearchRequest) -> None:
    try:
        jur_text = ", ".join(body.jurisdiction) or "US"
        ind_text = ", ".join(body.industry_tags) or "financial services"
        prompt = f"""Research this regulation and return the compliance dimension JSON:

Regulation: {body.name}
{f'Short name: {body.short_name}' if body.short_name else ''}
{f'Issuing body: {body.issuing_body}' if body.issuing_body else ''}
Jurisdiction: {jur_text}
Industry: {ind_text}

Use web search to find the official regulation text, recent enforcement actions,
and compliance requirements. Return ONLY the JSON object."""
        dims, sources, notice, turns = await _run_research(provider, api_key, REG_RESEARCH_SYSTEM, prompt)
        _jobs[job_id].result = ResearchResponse(dimensions=dims, sources=sources, notice=notice, turns_used=turns).model_dump()
        _jobs[job_id].status = "done"
    except Exception as exc:
        _jobs[job_id].status = "error"
        _jobs[job_id].error  = str(exc)


@router.post("/research/regulation")
async def research_regulation(body: RegResearchRequest, background_tasks: BackgroundTasks):
    provider, api_key = _resolve_compliance_llm()
    job_id = str(uuid.uuid4())
    _jobs[job_id] = _Job()
    background_tasks.add_task(_bg_regulation_research, job_id, provider, api_key, body)
    return {"job_id": job_id}


# =============================================================
# POST /research/policy
# =============================================================

async def _bg_policy_research(job_id: str, provider: str, api_key: str, body: PolicyResearchRequest, co_ctx: str) -> None:
    try:
        doc_ctx  = f"\n\nPolicy document extract:\n{body.doc_text[:4000]}" if body.doc_text else ""
        desc_ctx = f"\nDescription: {body.description}" if body.description else ""
        prompt = f"""Analyse this internal policy and return the compliance dimension JSON:

Policy name: {body.name}{desc_ctx}
{co_ctx}{doc_ctx}

Identify the key requirements, controls, audit obligations, and business impact
of this policy. The impact dimension is MANDATORY. Return ONLY the JSON object."""
        dims, sources, notice, turns = await _run_research(provider, api_key, POLICY_RESEARCH_SYSTEM, prompt)
        _jobs[job_id].result = ResearchResponse(dimensions=dims, sources=sources, notice=notice, turns_used=turns).model_dump()
        _jobs[job_id].status = "done"
    except Exception as exc:
        _jobs[job_id].status = "error"
        _jobs[job_id].error  = str(exc)


@router.post("/research/policy")
async def research_policy(body: PolicyResearchRequest, background_tasks: BackgroundTasks, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    provider, api_key = _resolve_compliance_llm()

    company_row = await db.execute(
        text("SELECT name, industry, region FROM twin.company WHERE id = :id AND tenant_id = :tid"),
        {"id": body.company_id, "tid": tenant_id}
    )
    company = company_row.mappings().first()
    co_ctx  = f"Company: {company['name']} | Industry: {company['industry']}" if company else ""

    job_id = str(uuid.uuid4())
    _jobs[job_id] = _Job()
    background_tasks.add_task(_bg_policy_research, job_id, provider, api_key, body, co_ctx)
    return {"job_id": job_id}


# =============================================================
# POST /save-dimensions
# =============================================================

class SaveDimsRequest(BaseModel):
    compliance_item_id: str
    dimensions:         list[ResearchedDimension]

@router.post("/save-dimensions")
async def save_dimensions(body: SaveDimsRequest, db: AsyncSession = Depends(get_db)):
    type_rows = await db.execute(text("SELECT id, category FROM twin.compliance_dim_type ORDER BY category"))
    type_map  = {r.category: str(r.id) for r in type_rows}

    saved = skipped = 0
    for i, dim in enumerate(body.dimensions):
        dim_type_id = type_map.get(dim.category) or type_map.get('custom')
        if not dim_type_id: continue
        exists = await db.execute(
            text("SELECT 1 FROM twin.compliance_dimension WHERE compliance_item_id=:cid AND lower(label)=lower(:label) AND valid_to IS NULL"),
            {"cid": body.compliance_item_id, "label": dim.label}
        )
        if exists.scalar():
            skipped += 1
            continue
        await db.execute(text("""
            INSERT INTO twin.compliance_dimension
                (compliance_item_id, dim_type_id, label, summary, tags, sort_order)
            VALUES (:cid, :dtid, :label, :summary, cast(:tags as jsonb), :order)
        """), {
            "cid":     body.compliance_item_id,
            "dtid":    dim_type_id,
            "label":   dim.label,
            "summary": dim.summary,
            "tags":    json.dumps(dim.tags),
            "order":   i,
        })
        saved += 1

    await db.execute(
        text("UPDATE twin.compliance_item SET ai_researched = true WHERE id = :id"),
        {"id": body.compliance_item_id}
    )
    await db.commit()
    return {"saved": saved, "skipped": skipped}
