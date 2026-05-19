# ======================================================# api/routers/compliance_research.py
# AI-powered research for regulations and policies.
# Same multi-turn pattern as blueprint.py research.
# ======================================================
import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db

router = APIRouter()

# ── In-memory job store ───────────────────────────────────────────────────────

@dataclass
class _Job:
    status: str = "pending"   # pending | done | error
    result: Optional[dict] = None
    error:  Optional[str]  = None

_jobs: dict[str, _Job] = {}

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"
OPENAI_API_URL    = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL      = "gpt-4o"
MAX_OUTPUT_TOKENS = int(os.getenv("RESEARCH_MAX_OUTPUT_TOKENS", "4096"))
MAX_SEARCH_TURNS  = int(os.getenv("RESEARCH_MAX_SEARCH_TURNS",  "3"))


# ======================================================# Schemas
# ======================================================
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


# ======================================================# Helpers (same as blueprint.py)
# ======================================================
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


async def _call_anthropic(
    api_key: str,
    messages: list[dict],
    system: str,
    tools: list[dict] | None = None,
    max_tokens: int = MAX_OUTPUT_TOKENS,
) -> dict:
    payload: dict[str, Any] = {
        "model": ANTHROPIC_MODEL, "max_tokens": max_tokens,
        "system": system, "messages": messages,
    }
    if tools: payload["tools"] = tools
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json=payload,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic error {resp.status_code}: {resp.text[:300]}")
    return resp.json()


async def _call_openai(
    api_key: str,
    messages: list[dict],
    system: str,
    max_tokens: int = MAX_OUTPUT_TOKENS,
) -> dict:
    payload_messages = [{"role": "system", "content": system}] + messages
    payload: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": payload_messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenAI error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
    finish_reason = data.get("choices", [{}])[0].get("finish_reason", "stop")
    return {
        "stop_reason": "max_tokens" if finish_reason == "length" else "end_turn",
        "content": [{"type": "text", "text": content}],
        "usage": data.get("usage", {}),
    }


def _resolve_compliance_llm() -> tuple[str, str]:
    """
    Resolve provider/key for compliance research endpoints.
    Priority:
    1) COMPLIANCE_LLM_PROVIDER=openai|anthropic (if key exists)
    2) ANTHROPIC_API_KEY if present (default, supports web search)
    3) OPENAI_API_KEY if present
    """
    preferred = (os.getenv("COMPLIANCE_LLM_PROVIDER", "").strip().lower() or None)
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    if preferred == "openai":
        if not openai_key:
            raise HTTPException(status_code=500, detail="COMPLIANCE_LLM_PROVIDER=openai but OPENAI_API_KEY not configured")
        return "openai", openai_key
    if preferred == "anthropic":
        if not anthropic_key:
            raise HTTPException(status_code=500, detail="COMPLIANCE_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY not configured")
        return "anthropic", anthropic_key

    if anthropic_key:
        return "anthropic", anthropic_key
    if openai_key:
        return "openai", openai_key
    raise HTTPException(status_code=500, detail="No LLM key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY")


def _collect_text(data: dict) -> str:
    return "\n".join(b["text"] for b in data.get("content", []) if b.get("type") == "text").strip()


def _collect_tool_results(data: dict) -> list[dict]:
    return [{"type": "tool_result", "tool_use_id": b["id"], "content": "Search done. Return JSON now."}
            for b in data.get("content", []) if b.get("type") == "tool_use"]


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
    turns    = 0

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
    # Strip invalid JSON control characters (keep tab, newline, carriage return)
    raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", raw)

    # Truncation recovery
    if data.get("stop_reason") == "max_tokens":
        try: json.loads(_extract_json(raw), strict=False)
        except json.JSONDecodeError:
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": "Continue and complete the JSON from where you left off."})
            if provider == "openai":
                cont = await _call_openai(api_key, messages, system, MAX_OUTPUT_TOKENS)
            else:
                cont = await _call_anthropic(api_key, messages, system, tools=None)
            cont_text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", _collect_text(cont).strip())
            raw = raw + cont_text

    try:
        parsed = json.loads(_extract_json(raw), strict=False)
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"JSON parse error: {str(e)[:200]}")

    dims    = [ResearchedDimension(**d) for d in parsed.get("dimensions", [])]
    sources = parsed.get("sources", [])
    notice  = parsed.get("notice", "AI-generated — please verify before use.")
    return dims, sources, notice, turns


# ======================================================# Regulation research system prompt
# ======================================================
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


# ======================================================# Policy research system prompt
# ======================================================
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


# ======================================================# GET /research/job/{job_id}
# ======================================================
@router.get("/research/job/{job_id}")
async def get_research_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"status": job.status, "result": job.result, "error": job.error}


# ======================================================# POST /research/regulation  — returns job_id immediately
# ======================================================
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


# ======================================================# POST /research/policy  — returns job_id immediately
# ======================================================
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
async def research_policy(body: PolicyResearchRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    provider, api_key = _resolve_compliance_llm()

    company_row = await db.execute(
        text("SELECT name, industry, region FROM twin.company WHERE id = :id"),
        {"id": body.company_id}
    )
    company = company_row.mappings().first()
    co_ctx  = f"Company: {company['name']} | Industry: {company['industry']}" if company else ""

    job_id = str(uuid.uuid4())
    _jobs[job_id] = _Job()
    background_tasks.add_task(_bg_policy_research, job_id, provider, api_key, body, co_ctx)
    return {"job_id": job_id}


# ======================================================# POST /save-dimensions
# Save AI-researched dimensions to a compliance item
# ======================================================
class SaveDimsRequest(BaseModel):
    compliance_item_id: str
    dimensions:         list[ResearchedDimension]

@router.post("/save-dimensions")
async def save_dimensions(body: SaveDimsRequest, db: AsyncSession = Depends(get_db)):
    # Get dim type map
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

    # Mark as AI researched
    await db.execute(
        text("UPDATE twin.compliance_item SET ai_researched = true WHERE id = :id"),
        {"id": body.compliance_item_id}
    )
    await db.commit()
    return {"saved": saved, "skipped": skipped}
