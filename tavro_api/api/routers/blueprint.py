# =============================================================
# api/routers/blueprint.py
# =============================================================

import asyncio
import json
import logging
import os
import re
from typing import Any, AsyncGenerator
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException

_logger = logging.getLogger(__name__)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.templates import INDUSTRY_TEMPLATES
from api.llm_utils import (
    ANTHROPIC_MODEL, OPENAI_MODEL, RESEARCH_MAX_OUTPUT_TOKENS,
    _call_anthropic, _call_openai, _collect_text, _extract_json,
)

router = APIRouter()

# RESEARCH_MAX_SEARCH_TURNS: max web-search round-trips (override via env var).
RESEARCH_MAX_SEARCH_TURNS: int = int(os.getenv("RESEARCH_MAX_SEARCH_TURNS", "3"))


# =============================================================
# Schemas
# =============================================================

class ResearchRequest(BaseModel):
    company_id:   str
    company_name: str
    ticker:       str | None = None
    industry:     str
    region:       str  = ""     # kept for backwards-compat; no longer required
    is_public:    bool = False  # true = public company even if ticker omitted

class ResearchedNode(BaseModel):
    category:   str
    label:      str
    summary:    str
    tags:       list[str]
    visibility: str  = "internal"
    sensitive:  bool = False

class ResearchResponse(BaseModel):
    nodes:        list[ResearchedNode]
    sources:      list[str]
    notice:       str
    turns_used:   int   # how many search turns were consumed
    tokens_cap:   int   # the max_tokens value that was applied

class SeedTemplateRequest(BaseModel):
    company_id: str
    template:   str

class SaveResearchedRequest(BaseModel):
    company_id: str
    nodes:      list[ResearchedNode]


# =============================================================
# Helpers
# =============================================================

async def _create_business_entity(
    db: AsyncSession,
    company_id: str,
    company_name: str | None,
    tenant_id: str | None,
    category: str,
    label: str,
    summary: str | None,
    tags: list,
) -> bool:
    """
    Upsert the corresponding Application / Process / Integration record.
    Called after dim_node creation — non-fatal, errors are logged and rolled back.
    Returns True if a new row was inserted, False if it already existed or was skipped.
    """
    label = (label or "").strip()
    if not label:
        return False
    tags_json = json.dumps(tags or [])

    if category == "application":
        table, id_col, name_col, desc_col = (
            "core.business_applications", "business_application_id", "application_name", "application_description"
        )
    elif category == "process":
        table, id_col, name_col, desc_col = (
            "core.business_processes", "business_process_id", "process_name", "process_description"
        )
    elif category == "integration":
        table, id_col, name_col, desc_col = (
            "core.business_integrations", "integration_id", "integration_name", "integration_description"
        )
    else:
        return False

    try:
        exists = await db.execute(
            text(f"SELECT 1 FROM {table} WHERE LOWER({name_col}) = LOWER(:n) AND company_id = :c LIMIT 1"),
            {"n": label, "c": company_id},
        )
        if exists.scalar():
            return False

        await db.execute(
            text(f"""
                INSERT INTO {table}
                    ({id_col}, {name_col}, {desc_col}, company_id, company_name, tenant_id, tags)
                VALUES (:id, :name, :desc, :cid, :cname, :tid, cast(:tags as jsonb))
            """),
            {"id": uuid4().hex, "name": label, "desc": summary,
             "cid": company_id, "cname": company_name, "tid": tenant_id, "tags": tags_json},
        )
        await db.commit()
        return True

    except Exception as e:
        _logger.warning("_create_business_entity failed [%s] '%s': %s", category, label, e)
        await db.rollback()
        return False


def _resolve_blueprint_llm() -> tuple[str, str]:
    """
    Resolve provider/key for blueprint endpoints.
    Research flows are enforced to Anthropic-only.
    """
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if anthropic_key:
        return "anthropic", anthropic_key
    raise HTTPException(
        status_code=500,
        detail="Anthropic research is required but ANTHROPIC_API_KEY is not configured.",
    )


def _collect_tool_results(data: dict) -> list[dict]:
    return [
        {
            "type":        "tool_result",
            "tool_use_id": b["id"],
            "content":     "Search completed. Now return ONLY the JSON object.",
        }
        for b in data.get("content", []) if b.get("type") == "tool_use"
    ]


async def _fetch_sec_filing_info(ticker: str) -> dict:
    """
    Look up a public company on SEC EDGAR by ticker symbol.
    Returns structured metadata + the direct URL of the latest 10-K document
    so the AI can fetch it during web-search turns.

    SEC EDGAR requires a User-Agent header identifying the caller.
    Docs: https://www.sec.gov/developer
    """
    headers = {"User-Agent": "Tavro Platform research@tavro.ai"}
    result: dict = {}
    try:
        async with httpx.AsyncClient(
            timeout=25.0, headers=headers, follow_redirects=True
        ) as client:
            # ── Step 1: Search EDGAR for the ticker's 10-K filings ───────────
            url1 = "https://efts.sec.gov/LATEST/search-index"
            params1 = {"q": f'"{ticker}"', "forms": "10-K", "dateRange": "custom", "startdt": "2021-01-01"}
            _logger.debug("[SEC/ticker] GET %s params=%s", url1, params1)
            search_resp = await client.get(url1, params=params1)
            _logger.debug("[SEC/ticker] step1 status=%s body=%s", search_resp.status_code, search_resp.text[:800])
            if search_resp.status_code != 200:
                return result

            hits = search_resp.json().get("hits", {}).get("hits", [])
            if not hits:
                _logger.debug("[SEC/ticker] step1 — no hits returned")
                return result

            src = hits[0]["_source"]
            acc_no       = src.get("accession_no", "")
            entity_name  = src.get("entity_name",  "")
            file_date    = src.get("file_date",    "")
            period       = src.get("period_of_report", "")
            _logger.debug("[SEC/ticker] step1 hit: entity=%r acc_no=%s date=%s period=%s", entity_name, acc_no, file_date, period)

            cik_str = acc_no.split("-")[0] if "-" in acc_no else ""
            if not cik_str:
                _logger.debug("[SEC/ticker] step1 — could not parse CIK from accession_no")
                return result
            cik_int = int(cik_str)

            result = {
                "entity_name":         entity_name,
                "cik":                 cik_str,
                "latest_10k_date":     file_date,
                "latest_10k_period":   period,
                "filing_browser_url":  (
                    f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                    f"&CIK={cik_str}&type=10-K&dateb=&owner=include&count=5"
                ),
            }

            # ── Step 2: Company submissions → richer metadata + doc URL ──────
            url2 = f"https://data.sec.gov/submissions/CIK{cik_str}.json"
            _logger.debug("[SEC/ticker] GET %s", url2)
            subs_resp = await client.get(url2)
            _logger.debug("[SEC/ticker] step2 status=%s body_len=%d", subs_resp.status_code, len(subs_resp.text))
            if subs_resp.status_code == 200:
                subs = subs_resp.json()
                result["sic_description"]        = subs.get("sicDescription", "")
                result["state_of_incorporation"] = subs.get("stateOfIncorporationDescription", "")
                result["fiscal_year_end"]        = subs.get("fiscalYearEnd", "")
                biz = subs.get("addresses", {}).get("business", {})
                result["hq"] = (
                    f"{biz.get('city','')}, {biz.get('stateOrCountry','')}".strip(", ")
                )
                _logger.debug("[SEC/ticker] step2 parsed: sic=%r hq=%r fy_end=%r",
                              result['sic_description'], result['hq'], result['fiscal_year_end'])

                recent = subs.get("filings", {}).get("recent", {})
                for form, acc, doc in zip(
                    recent.get("form",            []),
                    recent.get("accessionNumber", []),
                    recent.get("primaryDocument", []),
                ):
                    if form == "10-K" and doc:
                        acc_clean = acc.replace("-", "")
                        result["doc_url"] = (
                            f"https://www.sec.gov/Archives/edgar/data/"
                            f"{cik_int}/{acc_clean}/{doc}"
                        )
                        _logger.debug("[SEC/ticker] 10-K doc_url=%s", result['doc_url'])
                        break

    except Exception as exc:
        _logger.error("[SEC/ticker] ERROR — %s: %s", type(exc).__name__, exc)

    _logger.debug("[SEC/ticker] final result keys: %s", list(result.keys()))
    return result


async def _search_sec_by_name(company_name: str) -> dict:
    """
    Search SEC EDGAR by company name when no ticker is available.
    Returns the same dict shape as _fetch_sec_filing_info, plus a 'ticker' key
    if EDGAR exposes one. Returns {} on any failure (best-effort).
    """
    headers = {"User-Agent": "Tavro Platform research@tavro.ai"}
    result: dict = {}
    try:
        async with httpx.AsyncClient(
            timeout=20.0, headers=headers, follow_redirects=True
        ) as client:
            # ── Step 1: Full-text search for recent 10-K filings ─────────────
            url1 = "https://efts.sec.gov/LATEST/search-index"
            params1 = {"q": f'"{company_name}"', "forms": "10-K", "dateRange": "custom", "startdt": "2022-01-01"}
            _logger.debug("[SEC/name] GET %s params=%s", url1, params1)
            search_resp = await client.get(url1, params=params1)
            _logger.debug("[SEC/name] step1 status=%s body=%s", search_resp.status_code, search_resp.text[:800])
            if search_resp.status_code != 200:
                return result

            hits = search_resp.json().get("hits", {}).get("hits", [])
            if not hits:
                _logger.debug("[SEC/name] step1 — no hits returned")
                return result

            src       = hits[0]["_source"]
            acc_no    = src.get("accession_no", "")
            entity    = src.get("entity_name",  "")
            file_date = src.get("file_date",    "")
            period    = src.get("period_of_report", "")
            _logger.debug("[SEC/name] step1 hit: entity=%r acc_no=%s date=%s period=%s", entity, acc_no, file_date, period)

            cik_str = acc_no.split("-")[0] if "-" in acc_no else ""
            if not cik_str:
                _logger.debug("[SEC/name] step1 — could not parse CIK from accession_no")
                return result
            cik_int = int(cik_str)

            result = {
                "entity_name":       entity,
                "cik":               cik_str,
                "latest_10k_date":   file_date,
                "latest_10k_period": period,
                "filing_browser_url": (
                    f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                    f"&CIK={cik_str}&type=10-K&dateb=&owner=include&count=5"
                ),
            }

            # ── Step 2: Submissions API → richer metadata + ticker + doc URL ─
            url2 = f"https://data.sec.gov/submissions/CIK{cik_str}.json"
            _logger.debug("[SEC/name] GET %s", url2)
            subs_resp = await client.get(url2)
            _logger.debug("[SEC/name] step2 status=%s body_len=%d", subs_resp.status_code, len(subs_resp.text))
            if subs_resp.status_code == 200:
                subs = subs_resp.json()
                result["sic_description"]        = subs.get("sicDescription", "")
                result["state_of_incorporation"] = subs.get("stateOfIncorporationDescription", "")
                result["fiscal_year_end"]        = subs.get("fiscalYearEnd", "")
                biz = subs.get("addresses", {}).get("business", {})
                result["hq"] = (
                    f"{biz.get('city','')}, {biz.get('stateOrCountry','')}".strip(", ")
                )
                tickers = subs.get("tickers", [])
                if tickers:
                    result["ticker"] = tickers[0]
                _logger.debug("[SEC/name] step2 parsed: sic=%r hq=%r tickers=%s",
                              result['sic_description'], result['hq'], tickers)

                recent = subs.get("filings", {}).get("recent", {})
                for form, acc, doc in zip(
                    recent.get("form",            []),
                    recent.get("accessionNumber", []),
                    recent.get("primaryDocument", []),
                ):
                    if form == "10-K" and doc:
                        acc_clean = acc.replace("-", "")
                        result["doc_url"] = (
                            f"https://www.sec.gov/Archives/edgar/data/"
                            f"{cik_int}/{acc_clean}/{doc}"
                        )
                        _logger.debug("[SEC/name] 10-K doc_url=%s", result['doc_url'])
                        break

    except Exception as exc:
        _logger.error("[SEC/name] ERROR — %s: %s", type(exc).__name__, exc)

    _logger.debug("[SEC/name] final result keys: %s", list(result.keys()))
    return result


# =============================================================
# Private company fallback — used when all Anthropic retries fail
# so the research step never errors out for private companies.
# =============================================================

def _private_company_fallback(company_name: str, industry: str) -> dict:
    ind = industry.strip() or "the industry"
    slug = ind.lower().replace(" ", "-")
    return {
        "nodes": [
            {
                "category": "profile",
                "label": f"{company_name} – Company Overview",
                "summary": (
                    f"{company_name} is a privately held company operating in the {ind} sector. "
                    f"As a private organisation it focuses on delivering value to its stakeholders "
                    f"without the reporting obligations of a publicly listed company."
                ),
                "tags": ["private-company", slug, "overview"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "strategy",
                "label": "Market Growth and Client Acquisition",
                "summary": (
                    f"Expanding market share within the {ind} sector through organic growth, "
                    f"targeted client acquisition, and strategic partnerships. "
                    f"Priority is placed on deepening existing client relationships."
                ),
                "tags": ["growth", "client-acquisition", slug],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "strategy",
                "label": "Operational Excellence",
                "summary": (
                    f"Continuous improvement of core {ind} processes to reduce cost, "
                    f"increase throughput, and improve quality. "
                    f"Investment in technology and talent underpins this priority."
                ),
                "tags": ["operations", "efficiency", "process-improvement"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "strategy",
                "label": "Technology and Innovation",
                "summary": (
                    f"Adopting modern tooling and data-driven practices to stay competitive "
                    f"in the {ind} space. Digital initiatives are prioritised at board level."
                ),
                "tags": ["technology", "innovation", "digital"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "organisation",
                "label": "Core Business Operations",
                "summary": (
                    f"The primary revenue-generating function delivering {ind} products or services "
                    f"to customers. This unit owns end-to-end service delivery and client satisfaction."
                ),
                "tags": ["operations", "revenue", slug],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "organisation",
                "label": "Sales and Business Development",
                "summary": (
                    f"Responsible for pipeline generation, client relationships, and revenue growth. "
                    f"Works closely with operations to convert opportunities into delivered engagements."
                ),
                "tags": ["sales", "business-development", "revenue"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "organisation",
                "label": "Finance and Corporate Functions",
                "summary": (
                    f"Provides financial planning, reporting, compliance, HR, and legal support "
                    f"across the organisation. Ensures regulatory obligations are met and capital "
                    f"is allocated effectively."
                ),
                "tags": ["finance", "hr", "legal", "compliance"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "finance",
                "label": "Revenue Model",
                "summary": (
                    f"Revenue is generated through {ind}-sector products or services sold to clients. "
                    f"The mix of recurring vs. project-based income depends on the specific business model."
                ),
                "tags": ["revenue-model", "recurring-revenue", slug],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "finance",
                "label": "Cost Structure",
                "summary": (
                    f"Primary cost drivers include personnel, technology, and operational overhead "
                    f"typical of a {ind} business. Managing cost-to-income ratio is a key financial discipline."
                ),
                "tags": ["cost-structure", "opex", "margins"],
                "visibility": "internal",
                "sensitive": False,
            },
            {
                "category": "finance",
                "label": "Capital and Liquidity",
                "summary": (
                    f"As a private company, capital is sourced from owners, retained earnings, or "
                    f"private debt facilities. Liquidity management and reinvestment decisions are made "
                    f"by the ownership group."
                ),
                "tags": ["capital", "liquidity", "private-equity"],
                "visibility": "internal",
                "sensitive": False,
            },
        ],
        "sources": ["Template baseline (AI unavailable — please update with actual data)"],
        "notice": (
            "These are template-based baseline dimensions generated without AI because the "
            "AI service was temporarily unavailable. Please review and update with actual company data."
        ),
    }


# =============================================================
# Research system prompts (one per company type)
# =============================================================


PRIVATE_RESEARCH_SYSTEM = """You are a business analyst AI helping populate a Company Blueprint
for an enterprise AI governance platform called Tavro.

This is a PRIVATE company (not publicly listed). You do NOT have access to SEC filings or
public disclosures. Generate plausible, well-structured baseline dimension suggestions based
solely on the company name and industry provided. Do not fabricate specific financial figures
or cite sources you cannot verify — use representative ranges and qualitative descriptions
appropriate for a typical company in this industry.

Return ONLY a JSON object (no prose, no markdown fences, no explanation):

{
  "nodes": [
    {
      "category": "profile",
      "label": "string",
      "summary": "2-5 sentence plain text description",
      "tags": ["lowercase-hyphenated", "keywords"],
      "visibility": "internal",
      "sensitive": false
    }
  ],
  "sources": ["AI-generated baseline"],
  "notice": "One sentence noting this is AI-generated and should be reviewed and updated with actual company data."
}

Categories to include:
- "profile": exactly 1 node — company overview, HQ region, size/stage, key markets
- "strategy": exactly 3 nodes — one per major strategic priority for this industry
- "organisation": exactly 3 nodes — one per major business unit or functional area
- "finance": exactly 3 nodes — revenue model, cost structure, key financial metrics

Rules:
- Do NOT invent specific revenue figures, employee counts, or named executives
- Use qualitative descriptions and industry-typical ranges where appropriate
- Summaries: 2-3 sentences maximum, plain text, no bullet points, no line breaks inside a summary
- Tags: lowercase, hyphen-separated, max 5 per node
- Return ONLY the raw JSON object. No markdown. No code fences. No backticks.
Start your response with { and end with }."""


PUBLIC_RESEARCH_SYSTEM = """You are a business analyst AI helping populate a Company Blueprint
for an enterprise AI governance platform called Tavro.

This is a PUBLICLY LISTED company. You MUST base your research on official SEC filings,
specifically the company's most recent 10-K annual report on SEC EDGAR. Do not rely on
general knowledge — retrieve the actual filing from the URL(s) provided in the prompt.

Return ONLY a JSON object (no prose, no markdown fences, no explanation):

{
  "nodes": [
    {
      "category": "profile",
      "label": "string",
      "summary": "2-5 sentence plain text description",
      "tags": ["lowercase-hyphenated", "keywords"],
      "visibility": "internal",
      "sensitive": false
    }
  ],
  "sources": ["10-K FY2024 (SEC EDGAR)", "DEF 14A 2024"],
  "notice": "One sentence noting this is sourced from SEC EDGAR filings."
}

Categories to include (draw directly from the 10-K):
- "profile": exactly 1 node — legal name, state of incorporation, HQ, employee count,
  fiscal year-end, principal markets (from Item 1 Business section)
- "strategy": 3-5 nodes — each node is one major strategic priority stated in the
  10-K (Item 1 Business, Item 7 MD&A, or earnings communications)
- "organisation": 3-6 nodes — each node is one reportable business segment or major
  division as disclosed in the 10-K segment footnotes
- "finance": 3-5 nodes — draw from Item 8 Financial Statements and Item 7 MD&A:
  annual revenue, net income / EPS, key balance sheet metrics (total assets, long-term
  debt), capital allocation (dividends, buybacks), and any significant financial trends

Rules:
- Base summaries on the actual 10-K text; cite the filing year in each summary
- Use specific numbers (e.g. "$5.2B revenue FY2023") where disclosed
- Summaries: 2-5 sentences, plain text, no bullet points
- Tags: lowercase, hyphen-separated, max 8 per node
- Return ONLY the raw JSON object. No markdown. No code fences. No backticks.
Start your response with { and end with }."""


# =============================================================
# SSE helper
# =============================================================

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# =============================================================
# POST /research  — streams SSE to avoid Cloudflare 524 timeouts
# =============================================================

@router.post("/research")
async def research_company(body: ResearchRequest, db: AsyncSession = Depends(get_db)):
    """
    Streams research progress as Server-Sent Events so that the Cloudflare
    proxy read timeout is never hit. Each event is a JSON object:
      {"type": "status",    "message": "…"}   — progress update
      {"type": "heartbeat"}                    — keep-alive (every ~8 s)
      {"type": "result",    "data":  {…}}      — final ResearchResponse payload
      {"type": "error",     "message": "…"}    — terminal error
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def do_research() -> None:
        import time
        t0 = time.monotonic()

        def log(msg: str) -> None:
            elapsed = time.monotonic() - t0
            _logger.debug("[Research %5.1fs] %s", elapsed, msg)

        async def emit(event: dict) -> None:
            log(event.get("message", event.get("type", "?")))
            await queue.put(event)

        try:
            # ── Resolve LLM ──────────────────────────────────────────────────
            try:
                provider, api_key = _resolve_blueprint_llm()
            except HTTPException as e:
                log(f"ERROR — LLM not configured: {e.detail}")
                await queue.put({"type": "error", "message": e.detail})
                return

            is_public = body.is_public or bool(body.ticker)

            # ── Request banner ───────────────────────────────────────────────
            log("=" * 60)
            log("RESEARCH REQUEST")
            log(f"  company_name : {body.company_name!r}")
            log(f"  industry     : {body.industry!r}")
            log(f"  ticker       : {body.ticker!r}")
            log(f"  is_public    : {is_public}  (body.is_public={body.is_public}, ticker={'yes' if body.ticker else 'no'})")
            log(f"  provider     : {provider}")
            log(f"  max_tokens   : {RESEARCH_MAX_OUTPUT_TOKENS}")
            log(f"  max_turns    : {RESEARCH_MAX_SEARCH_TURNS}")
            log("=" * 60)
            await emit({"type": "status", "message": "Starting research…"})

            # ── SEC EDGAR fetch (public companies only) ──────────────────────
            sec_ctx: dict = {}
            if is_public:
                if body.ticker:
                    log(f"Fetching SEC EDGAR by ticker: {body.ticker}")
                    await emit({"type": "status",
                                "message": f"Fetching SEC EDGAR filings for {body.ticker}…"})
                    sec_ctx = await _fetch_sec_filing_info(body.ticker)
                else:
                    log(f"No ticker — searching SEC EDGAR by name: {body.company_name!r}")
                    await emit({"type": "status",
                                "message": f"Looking up {body.company_name} on SEC EDGAR…"})
                    sec_ctx = await _search_sec_by_name(body.company_name)
                    if sec_ctx.get("ticker"):
                        log(f"Discovered ticker from SEC: {sec_ctx['ticker']}")

                if sec_ctx.get("entity_name"):
                    log(f"SEC found: entity={sec_ctx.get('entity_name')!r} "
                        f"ticker={sec_ctx.get('ticker','n/a')} "
                        f"10-K={sec_ctx.get('latest_10k_date')} "
                        f"doc={sec_ctx.get('doc_url','none')}")
                    await emit({"type": "status",
                                "message": f"10-K found for {sec_ctx['entity_name']} — building query…"})
                else:
                    log("SEC EDGAR lookup returned nothing — falling back to web search only")
                    await emit({"type": "status",
                                "message": "SEC filing not found — will search the web directly…"})

            # ── Build prompts ────────────────────────────────────────────────
            if is_public:
                sec_block = ""
                if sec_ctx:
                    sec_block = (
                        f"\nSEC EDGAR Data (use these official sources — do NOT skip them):\n"
                        f"  Registered name : {sec_ctx.get('entity_name', body.company_name)}\n"
                        f"  CIK             : {sec_ctx.get('cik', 'unknown')}\n"
                        f"  HQ              : {sec_ctx.get('hq', '')}\n"
                        f"  SIC description : {sec_ctx.get('sic_description', '')}\n"
                        f"  State of incorp : {sec_ctx.get('state_of_incorporation', '')}\n"
                        f"  Fiscal year end : {sec_ctx.get('fiscal_year_end', '')}\n"
                        f"  Latest 10-K     : filed {sec_ctx.get('latest_10k_date', '')} "
                        f"(period ending {sec_ctx.get('latest_10k_period', '')})\n"
                        f"  10-K document   : {sec_ctx.get('doc_url', '')}\n"
                        f"  EDGAR filings   : {sec_ctx.get('filing_browser_url', '')}\n"
                    )
                    instruction = (
                        "Fetch the 10-K document URL above and read Item 1 (Business), "
                        "Item 7 (MD&A), and Item 8 (Financial Statements). "
                        "Base your nodes on facts from that document."
                    )
                else:
                    instruction = (
                        f"Search SEC EDGAR (https://www.sec.gov/cgi-bin/browse-edgar?"
                        f"action=getcompany&company=&CIK={body.ticker}&type=10-K&dateb="
                        f"&owner=include&count=5) for the latest 10-K filing. "
                        "Base your nodes on the actual 10-K content."
                    )
                user_prompt = (
                    f"Research this PUBLIC company using its SEC EDGAR 10-K filing "
                    f"and return the Blueprint JSON:\n\n"
                    f"Company : {body.company_name}\n"
                    f"Ticker  : {body.ticker}\n"
                    f"Industry: {body.industry}\n"
                    f"{sec_block}\n"
                    f"{instruction}\n\n"
                    f"Return ONLY the JSON object — no other text."
                )
                system_prompt = PUBLIC_RESEARCH_SYSTEM
            else:
                user_prompt = (
                    f"Generate baseline Blueprint dimensions for this PRIVATE company:\n\n"
                    f"Company : {body.company_name}\n"
                    f"Industry: {body.industry}\n\n"
                    f"Do NOT use web search. Use your knowledge of this industry to generate "
                    f"plausible Profile, Strategy, Organisation, and Finance dimensions. "
                    f"Return ONLY the JSON object — no other text."
                )
                system_prompt = PRIVATE_RESEARCH_SYSTEM

            messages: list[dict] = [{"role": "user", "content": user_prompt}]
            # Web search only for public companies — private companies use pure generation
            # Private: no web search, no SEC, single Anthropic call at 2000 tokens
            #          → fast, cheap, zero external dependencies = never fails
            # Public:  SEC EDGAR + web search up to RESEARCH_MAX_SEARCH_TURNS + full tokens
            max_turns  = RESEARCH_MAX_SEARCH_TURNS if is_public else 0
            max_tokens = RESEARCH_MAX_OUTPUT_TOKENS if is_public else min(RESEARCH_MAX_OUTPUT_TOKENS, 2500)
            tools = [{"type": "web_search_20250305", "name": "web_search"}] \
                    if (is_public and provider == "anthropic" and max_turns > 0) else None

            # ── Prompt/tools banner ──────────────────────────────────────────
            log("-" * 60)
            log(f"SYSTEM PROMPT    : {'PUBLIC_RESEARCH_SYSTEM' if is_public else 'PRIVATE_RESEARCH_SYSTEM'}")
            log(f"WEB SEARCH TOOLS : {'ENABLED' if tools else 'DISABLED (private — pure generation)'}")
            log(f"MAX SEARCH TURNS : {max_turns}")
            log(f"MAX TOKENS       : {max_tokens}")
            log(f"SEC PATH         : {'YES — ticker lookup + EDGAR' if is_public else 'NO — private company, skipped'}")
            log(f"USER PROMPT:\n{user_prompt}")
            log("-" * 60)

            # ── Turn 1 (with retry for reliability) ─────────────────────────
            log("Calling AI — turn 1")
            await emit({"type": "status", "message": "Sending request to AI model…"})
            last_exc: Exception | None = None
            data: dict = {}
            for attempt in range(1, 4):  # up to 3 attempts
                try:
                    if provider == "openai":
                        data = await _call_openai(api_key, messages, system_prompt, max_tokens)
                    else:
                        data = await _call_anthropic(api_key, messages, system_prompt, tools, max_tokens)
                    last_exc = None
                    break
                except Exception as exc:
                    last_exc = exc
                    log(f"Turn 1 attempt {attempt} failed — {type(exc).__name__}: {exc}")
                    if attempt < 3:
                        await asyncio.sleep(2 ** attempt)  # 2s then 4s back-off

            # Private company: if all retries failed, use the Python fallback so the
            # research step never errors out — user gets template dimensions instead.
            if last_exc:
                if not is_public:
                    log(f"All retries failed for private company — using template fallback")
                    await emit({"type": "status", "message": "AI unavailable — using baseline template…"})
                    fallback = _private_company_fallback(body.company_name, body.industry)
                    result = ResearchResponse(
                        nodes=[ResearchedNode(**n) for n in fallback["nodes"]],
                        sources=fallback["sources"],
                        notice=fallback["notice"],
                        turns_used=0,
                        tokens_cap=0,
                    )
                    log(f"Fallback result — {len(result.nodes)} template nodes")
                    await queue.put({"type": "result", "data": result.model_dump()})
                    return
                raise last_exc  # public company — still surface the error
            log(f"Turn 1 done — stop_reason={data.get('stop_reason')} usage={data.get('usage',{})}")
            turns_used = 0

            # ── Follow-up web-search turns ───────────────────────────────────
            while (provider == "anthropic"
                   and data.get("stop_reason") == "tool_use"
                   and turns_used < max_turns):
                tool_results = _collect_tool_results(data)
                if not tool_results:
                    break
                turns_used += 1
                log(f"Web-search turn {turns_used}/{max_turns}")
                await emit({"type": "status",
                            "message": f"AI searching the web (pass {turns_used} of {max_turns})…"})
                messages.append({"role": "assistant", "content": data["content"]})
                messages.append({"role": "user",      "content": tool_results})
                data = await _call_anthropic(api_key, messages, system_prompt, tools, max_tokens)
                log(f"Search turn {turns_used} done — stop_reason={data.get('stop_reason')}")

            # ── Force answer if turn cap hit ─────────────────────────────────
            if provider == "anthropic" and data.get("stop_reason") == "tool_use":
                tool_results = _collect_tool_results(data)
                if tool_results:
                    log("Turn cap hit — forcing final answer without tools")
                    await emit({"type": "status",
                                "message": "Web-search limit reached — compiling results…"})
                    messages.append({"role": "assistant", "content": data["content"]})
                    messages.append({
                        "role": "user",
                        "content": [{
                            **tr,
                            "content": (
                                "Search limit reached. Using information gathered so far, "
                                "return ONLY the JSON object now."
                            ),
                        } for tr in tool_results],
                    })
                    data = await _call_anthropic(
                        api_key, messages, system_prompt,
                        tools=None,
                        max_tokens=max_tokens,
                    )
                    log(f"Final forced answer — stop_reason={data.get('stop_reason')}")

            # ── Extract text ─────────────────────────────────────────────────
            raw_text = _collect_text(data)
            log(f"Raw AI response ({len(raw_text)} chars):\n"
                f"{'─'*60}\n{raw_text}\n{'─'*60}")
            if not raw_text:
                log("ERROR — AI returned empty text")
                await queue.put({"type": "error",
                                 "message": "AI returned an empty response. Please try again."})
                return

            # ── Parse JSON ───────────────────────────────────────────────────
            log("Parsing JSON response")
            await emit({"type": "status", "message": "Parsing results…"})
            cleaned = raw_text.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned).strip()

            extracted = _extract_json(cleaned)

            # Truncation recovery
            if data.get("stop_reason") == "max_tokens":
                try:
                    json.loads(extracted)
                    log("max_tokens but JSON is valid — no continuation needed")
                except json.JSONDecodeError:
                    log("max_tokens AND JSON truncated — requesting continuation")
                    await emit({"type": "status",
                                "message": "Response was truncated — requesting continuation…"})
                    messages.append({"role": "assistant", "content": raw_text})
                    messages.append({"role": "user", "content": (
                        "Your previous response was cut off before the JSON was complete. "
                        "Please continue and complete the JSON object from where you left off. "
                        "Return ONLY the continuation — no preamble, no backticks."
                    )})
                    if provider == "openai":
                        cont_data = await _call_openai(
                            api_key, messages, system_prompt, max_tokens
                        )
                    else:
                        cont_data = await _call_anthropic(
                            api_key, messages, system_prompt,
                            tools=None,
                            max_tokens=max_tokens,
                        )
                    continuation = _collect_text(cont_data).strip()
                    log(f"Continuation length: {len(continuation)} chars")
                    merged = raw_text.rstrip() + continuation
                    extracted = _extract_json(merged)

            # Strip invalid control characters (raw newlines/tabs inside string values)
            # that Claude occasionally emits in long summaries, causing JSONDecodeError.
            sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', extracted)

            try:
                parsed = json.loads(sanitized)
            except json.JSONDecodeError as e:
                log(f"ERROR — JSON parse failed: {e} | snippet: {sanitized[:300]!r}")
                await queue.put({"type": "error",
                                 "message": f"JSON parse error: {str(e)[:200]}"})
                return

            result = ResearchResponse(
                nodes=[ResearchedNode(**n) for n in parsed.get("nodes", [])],
                sources=parsed.get("sources", []),
                notice=parsed.get("notice", "AI-generated from public sources — please verify before use."),
                turns_used=turns_used,
                tokens_cap=RESEARCH_MAX_OUTPUT_TOKENS,
            )
            log("=" * 60)
            log(f"RESEARCH RESULT — {'PUBLIC' if is_public else 'PRIVATE'} company: {body.company_name!r}")
            log(f"  nodes        : {len(result.nodes)}")
            log(f"  search turns : {turns_used}")
            log(f"  sources      : {result.sources}")
            log(f"  notice       : {result.notice}")
            log(f"  total time   : {time.monotonic()-t0:.1f}s")
            log("  nodes breakdown:")
            for i, n in enumerate(result.nodes):
                log(f"    [{i}] category={n.category!r:14s} sensitive={n.sensitive}  label={n.label!r}")
            log("=" * 60)
            await queue.put({"type": "result", "data": result.model_dump()})

        except Exception as e:
            log(f"UNHANDLED ERROR — {type(e).__name__}: {e}")
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)  # sentinel — signals stream_events to stop

    async def stream_events() -> AsyncGenerator[str, None]:
        task = asyncio.create_task(do_research())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=8.0)
                    if item is None:
                        break
                    yield _sse(item)
                except asyncio.TimeoutError:
                    yield _sse({"type": "heartbeat"})
        finally:
            task.cancel()

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# =============================================================
# GET /research/config  — expose current caps to the frontend
# =============================================================

@router.get("/research/config")
async def research_config():
    provider, _ = _resolve_blueprint_llm()
    return {
        "max_output_tokens": RESEARCH_MAX_OUTPUT_TOKENS,
        "max_search_turns":  RESEARCH_MAX_SEARCH_TURNS,
        "model":             OPENAI_MODEL if provider == "openai" else ANTHROPIC_MODEL,
        "provider":          provider,
    }


# =============================================================
# POST /save-researched-nodes
# =============================================================

@router.post("/save-researched-nodes")
async def save_researched_nodes(
    body: SaveResearchedRequest,
    db:   AsyncSession = Depends(get_db),
):
    type_rows = await db.execute(text("SELECT id, category FROM twin.dim_type ORDER BY category"))
    type_map  = {row.category: str(row.id) for row in type_rows}
    saved = skipped = 0
    # (category, label, summary, tags, node_id)
    to_sync: list[tuple[str, str, str | None, list, str | None]] = []

    for node in body.nodes:
        dim_type_id = type_map.get(node.category)
        if not dim_type_id:
            continue

        is_entity = node.category in ("application", "process", "integration")

        ex_row = await db.execute(
            text("SELECT id FROM twin.dim_node WHERE company_id=:cid AND lower(label)=lower(:label) AND valid_to IS NULL LIMIT 1"),
            {"cid": body.company_id, "label": node.label},
        )
        existing = ex_row.mappings().first()
        if existing:
            skipped += 1
            if is_entity:
                to_sync.append((node.category, node.label, node.summary, node.tags, str(existing["id"])))
            continue

        ins = await db.execute(
            text("""INSERT INTO twin.dim_node
                    (company_id, dim_type_id, label, summary, tags, visibility, sensitive)
                    VALUES (:company_id, :dim_type_id, :label, :summary,
                            cast(:tags as jsonb), :visibility, :sensitive)
                    RETURNING id"""),
            {"company_id": body.company_id, "dim_type_id": dim_type_id,
             "label": node.label, "summary": node.summary,
             "tags": json.dumps(node.tags), "visibility": node.visibility,
             "sensitive": node.sensitive},
        )
        ins_row = ins.mappings().first()
        node_id = str(ins_row["id"]) if ins_row else None
        saved += 1
        if is_entity:
            to_sync.append((node.category, node.label, node.summary, node.tags, node_id))

    await db.commit()

    if to_sync:
        co_row = await db.execute(
            text("SELECT name, tenant_id FROM twin.company WHERE id = :id LIMIT 1"),
            {"id": body.company_id},
        )
        co = co_row.mappings().first() or {}
        company_name = co.get("name")
        company_tenant_id = co.get("tenant_id")
        from api.routers.business_relations import sync_dim_node_to_business_entity
        for category, label, summary, tags, node_id in to_sync:
            await sync_dim_node_to_business_entity(
                db, body.company_id, company_name, category, label, summary, tags,
                company_tenant_id, node_id=node_id,
            )

    return {"saved": saved, "skipped": skipped}


# =============================================================
# POST /seed-template
# =============================================================

@router.post("/seed-template")
async def seed_template(
    body: SeedTemplateRequest,
    db:   AsyncSession = Depends(get_db),
):
    template_nodes = INDUSTRY_TEMPLATES.get(body.template, [])
    if not template_nodes:
        return {"seeded": 0, "skipped": 0, "message": "Blank template — no nodes to seed."}

    type_rows = await db.execute(text("SELECT id, category FROM twin.dim_type ORDER BY category"))
    type_map  = {row.category: str(row.id) for row in type_rows}
    seeded = skipped = 0
    # (category, label, summary, tags, node_id)
    to_sync: list[tuple[str, str, str | None, list, str | None]] = []

    for node in template_nodes:
        dim_type_id = type_map.get(node["category"])
        if not dim_type_id:
            continue

        category = node["category"]
        is_entity = category in ("application", "process", "integration")

        # Check existence and capture id in one query
        ex_row = await db.execute(
            text("SELECT id FROM twin.dim_node WHERE company_id=:cid AND lower(label)=lower(:label) AND valid_to IS NULL LIMIT 1"),
            {"cid": body.company_id, "label": node["label"]},
        )
        existing = ex_row.mappings().first()
        if existing:
            skipped += 1
            if is_entity:
                to_sync.append((category, node["label"], node["summary"], node.get("tags", []), str(existing["id"])))
            continue

        ins = await db.execute(
            text("""INSERT INTO twin.dim_node
                    (company_id, dim_type_id, label, summary, tags, visibility, sensitive)
                    VALUES (:company_id, :dim_type_id, :label, :summary,
                            cast(:tags as jsonb), :visibility, :sensitive)
                    RETURNING id"""),
            {"company_id":  body.company_id,
             "dim_type_id": dim_type_id,
             "label":       node["label"],
             "summary":     node["summary"],
             "tags":        json.dumps(node["tags"]),
             "visibility":  node.get("visibility", "internal"),
             "sensitive":   node.get("sensitive", False)},
        )
        ins_row = ins.mappings().first()
        node_id = str(ins_row["id"]) if ins_row else None
        seeded += 1
        if is_entity:
            to_sync.append((category, node["label"], node["summary"], node.get("tags", []), node_id))

    await db.commit()

    if to_sync:
        co_row = await db.execute(
            text("SELECT name, tenant_id FROM twin.company WHERE id = :id LIMIT 1"),
            {"id": body.company_id},
        )
        co = co_row.mappings().first() or {}
        company_name = co.get("name")
        company_tenant_id = co.get("tenant_id")
        from api.routers.business_relations import sync_dim_node_to_business_entity
        for category, label, summary, tags, node_id in to_sync:
            await sync_dim_node_to_business_entity(
                db, body.company_id, company_name, category, label, summary, tags,
                company_tenant_id, node_id=node_id,
            )

    return {
        "seeded":  seeded,
        "skipped": skipped,
        "message": f"Seeded {seeded} nodes ({skipped} already existed).",
    }


# =============================================================
# POST /sync-business-entities
# Backfill: create missing Application / Process / Integration
# records for all existing dim_nodes of those categories.
# Safe to call multiple times — skips records that already exist.
# =============================================================

class SyncBusinessEntitiesRequest(BaseModel):
    company_id: str

@router.post("/sync-business-entities")
async def sync_business_entities(
    body: SyncBusinessEntitiesRequest,
    db:   AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT n.id, n.label, n.summary, n.tags, t.category
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE n.company_id = :cid
              AND t.category IN ('application', 'process', 'integration')
              AND n.valid_to IS NULL
        """),
        {"cid": body.company_id},
    )
    nodes = rows.mappings().all()

    co_row = await db.execute(
        text("SELECT name, tenant_id FROM twin.company WHERE id = :id LIMIT 1"),
        {"id": body.company_id},
    )
    co = co_row.mappings().first() or {}
    company_name = co.get("name")
    company_tenant_id = co.get("tenant_id")

    from api.routers.business_relations import sync_dim_node_to_business_entity
    created = skipped = 0
    for node in nodes:
        tags = node["tags"] if isinstance(node["tags"], list) else []
        await sync_dim_node_to_business_entity(
            db, body.company_id, company_name, node["category"],
            node["label"], node["summary"], tags,
            company_tenant_id, node_id=str(node["id"]),
        )
        created += 1

    return {"created": created, "skipped": skipped}


# =============================================================
# POST /suggest-dimension
# AI assistant: given company context + category + label,
# generate a relevant summary and tags.
# Lightweight call — no web search, uses twin context only.
# =============================================================

class SuggestDimensionRequest(BaseModel):
    company_id:   str
    company_name: str
    industry:     str
    category:     str
    label:        str
    existing_dims: list[str] = []   # labels of existing dims for richer context

class SuggestDimensionResponse(BaseModel):
    summary: str
    tags:    list[str]

SUGGEST_SYSTEM = """You are a business analyst AI helping populate a Company Blueprint
for an enterprise AI governance platform called Tavro.

Given a company name, industry, dimension category, and dimension label, generate:
1. A concise summary (2-5 sentences) describing what this dimension is in the context
   of that specific company. Be specific — mention the company name, their industry
   context, and how this dimension applies to them.
2. A list of 5-8 relevant tags (lowercase, hyphen-separated keywords).

Return ONLY a JSON object. No markdown. No backticks. Start with { end with }.
Format:
{
  "summary": "2-5 sentence description specific to the company and dimension",
  "tags": ["tag-one", "tag-two", "tag-three"]
}"""


@router.post("/suggest-dimension", response_model=SuggestDimensionResponse)
async def suggest_dimension(
    body: SuggestDimensionRequest,
    db:   AsyncSession = Depends(get_db),
):
    """
    Generate a context-aware summary and tags for a new dimension.
    Uses the company's existing blueprint dimensions as context.
    No web search — fast and cheap (single API call).
    """
    provider, api_key = _resolve_blueprint_llm()

    # Fetch a sample of existing node labels for context
    existing_rows = await db.execute(
        text("""
            SELECT n.label, t.category
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE n.company_id = :cid AND n.valid_to IS NULL
            ORDER BY t.category, n.label
            LIMIT 20
        """),
        {"cid": body.company_id},
    )
    existing = [f"{row.category}: {row.label}" for row in existing_rows]
    context_block = "\n".join(existing) if existing else "No existing dimensions yet."

    user_prompt = f"""Generate a summary and tags for this dimension:

Company: {body.company_name}
Industry: {body.industry}
Dimension category: {body.category}
Dimension label: {body.label}

Existing blueprint dimensions for context:
{context_block}

Return ONLY the JSON object with "summary" and "tags" fields."""

    if provider == "openai":
        data = await _call_openai(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_SYSTEM,
            1024,
        )
    else:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user_prompt}],
            SUGGEST_SYSTEM,
            tools=None,
            max_tokens=1024,
        )

    raw = _collect_text(data).strip()

    # Strip fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()

    try:
        parsed = json.loads(_extract_json(raw))
    except json.JSONDecodeError as e:
        _logger.error("AI response could not be parsed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="The AI service returned an unexpected response. Please try again.")

    return SuggestDimensionResponse(
        summary=parsed.get("summary", ""),
        tags=parsed.get("tags", []),
    )