# =============================================================
# api/routers/blueprint.py
# =============================================================

import json
import os
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.templates import INDUSTRY_TEMPLATES

router = APIRouter()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"

# ── Token / turn caps (override via environment variables) ────────────────────
# RESEARCH_MAX_OUTPUT_TOKENS: max tokens Claude may produce per API call.
#   Default 2048 — enough for a full 10-node JSON response with summaries.
#   Raise to 3000 if you want richer summaries; lower to 1024 to cut cost.
#
# RESEARCH_MAX_SEARCH_TURNS: max number of web-search round-trips allowed.
#   Default 3 — Claude rarely needs more than 2 for a well-known public company.
#   Set to 1 to force a single search; set to 0 to disable web search entirely.

RESEARCH_MAX_OUTPUT_TOKENS: int = int(os.getenv("RESEARCH_MAX_OUTPUT_TOKENS", "2048"))
RESEARCH_MAX_SEARCH_TURNS:  int = int(os.getenv("RESEARCH_MAX_SEARCH_TURNS",  "3"))


# =============================================================
# Schemas
# =============================================================

class ResearchRequest(BaseModel):
    company_id:   str
    company_name: str
    ticker:       str | None = None
    industry:     str
    region:       str

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

def _extract_json(raw: str) -> str:
    """
    Robustly extract a JSON object from text that may contain:
    - markdown code fences (```json ... ``` or ``` ... ```)
    - prose before/after the JSON
    - the word 'json' immediately after the opening fence
    """
    # 1. Strip markdown fences — handles ```json\n{...}``` and ```\n{...}```
    fenced = re.search(r'```(?:json)?[\s\n]*(\{[\s\S]*?\})[\s\n]*```', raw)
    if fenced:
        return fenced.group(1).strip()

    # 2. Also try fence without closing backticks (Claude sometimes omits them)
    fenced_open = re.search(r'```(?:json)?[\s\n]*(\{[\s\S]*)', raw)
    if fenced_open:
        candidate = fenced_open.group(1).strip()
        # Try to parse just the { ... } block from the candidate
        start = candidate.find('{')
        if start != -1:
            depth = 0
            for i, ch in enumerate(candidate[start:], start):
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        return candidate[start:i + 1]

    # 3. Find outermost { ... } in the raw string
    start = raw.find('{')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return raw[start:i + 1]

    return raw.strip()


async def _call_anthropic(
    api_key:    str,
    messages:   list[dict],
    system:     str,
    tools:      list[dict] | None = None,
    max_tokens: int = RESEARCH_MAX_OUTPUT_TOKENS,
) -> dict:
    payload: dict[str, Any] = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   messages,
    }
    if tools:
        payload["tools"] = tools

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic API error {resp.status_code}: {resp.text[:400]}"
        )
    return resp.json()


def _collect_text(data: dict) -> str:
    return "\n".join(
        b["text"] for b in data.get("content", []) if b.get("type") == "text"
    ).strip()


def _collect_tool_results(data: dict) -> list[dict]:
    return [
        {
            "type":        "tool_result",
            "tool_use_id": b["id"],
            "content":     "Search completed. Now return ONLY the JSON object.",
        }
        for b in data.get("content", []) if b.get("type") == "tool_use"
    ]


# =============================================================
# Research system prompt
# =============================================================

RESEARCH_SYSTEM = """You are a business analyst AI helping populate a Company Blueprint
for an enterprise AI governance platform called Tavro.

Your task: Research the given company using web search, then return ONLY a JSON object
(no prose, no markdown fences, no explanation) with this exact structure:

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
  "sources": ["10-K 2024", "Company website"],
  "notice": "One sentence noting this is AI-generated from public sources."
}

Categories to include:
- "profile": exactly 1 node — identity, HQ, size, founding, key markets
- "strategy": 3-5 nodes — one per major strategic priority from recent communications
- "organisation": 3-6 nodes — one per major business segment or division

Rules:
- Only use publicly available information
- Summaries: 2-5 sentences, plain text, no bullet points
- Tags: lowercase, hyphen-separated, max 8 per node
- Return ONLY the raw JSON object. No markdown. No code fences. No backticks.
Do not write ```json or ``` anywhere. Start your response with { and end with }."""


# =============================================================
# POST /research
# =============================================================

@router.post("/research", response_model=ResearchResponse)
async def research_company(body: ResearchRequest, db: AsyncSession = Depends(get_db)):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    ticker_line = f"Ticker: {body.ticker}" if body.ticker else ""
    user_prompt = (
        f"Research this company and return the Blueprint JSON:\n\n"
        f"Company: {body.company_name}\n{ticker_line}\n"
        f"Industry: {body.industry}\nRegion: {body.region}\n\n"
        f"Use web search to find accurate public information, "
        f"then return ONLY the JSON object — no other text."
    )

    messages: list[dict] = [{"role": "user", "content": user_prompt}]

    # Use web search only if turns > 0
    tools = [{"type": "web_search_20250305", "name": "web_search"}] \
            if RESEARCH_MAX_SEARCH_TURNS > 0 else None

    # ── Turn 1 ────────────────────────────────────────────────────────────────
    data       = await _call_anthropic(api_key, messages, RESEARCH_SYSTEM, tools)
    turns_used = 0

    # ── Follow-up turns while Claude uses web search ──────────────────────────
    while data.get("stop_reason") == "tool_use" and turns_used < RESEARCH_MAX_SEARCH_TURNS:
        tool_results = _collect_tool_results(data)
        if not tool_results:
            break
        turns_used += 1
        messages.append({"role": "assistant", "content": data["content"]})
        messages.append({"role": "user",      "content": tool_results})
        data = await _call_anthropic(api_key, messages, RESEARCH_SYSTEM, tools)

    # ── If we hit the turn cap but Claude still wants to search, force answer ──
    if data.get("stop_reason") == "tool_use":
        tool_results = _collect_tool_results(data)
        if tool_results:
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
            # Final call with no tools — forces a text response
            data = await _call_anthropic(
                api_key, messages, RESEARCH_SYSTEM,
                tools=None,  # no tools = must produce text
                max_tokens=RESEARCH_MAX_OUTPUT_TOKENS,
            )

    # ── Extract text ──────────────────────────────────────────────────────────
    raw_text = _collect_text(data)
    if not raw_text:
        raise HTTPException(status_code=502, detail="Claude returned an empty response. Try again.")

    # ── Parse JSON ────────────────────────────────────────────────────────────
    # Pre-clean: strip any stray backtick fences Claude may have added
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    extracted = _extract_json(cleaned)

    # Truncation recovery: if stop_reason was max_tokens, ask Claude to continue
    if data.get("stop_reason") == "max_tokens":
        try:
            json.loads(extracted)   # try first — maybe it's valid despite max_tokens
        except json.JSONDecodeError:
            # JSON was cut off — ask Claude to complete it without tools
            messages.append({"role": "assistant", "content": raw_text})
            messages.append({"role": "user", "content": (
                "Your previous response was cut off before the JSON was complete. "
                "Please continue and complete the JSON object from where you left off. "
                "Return ONLY the continuation — no preamble, no backticks."
            )})
            cont_data = await _call_anthropic(
                api_key, messages, RESEARCH_SYSTEM,
                tools=None,
                max_tokens=RESEARCH_MAX_OUTPUT_TOKENS,
            )
            continuation = _collect_text(cont_data).strip()
            # Merge: take the truncated part + continuation and re-extract
            merged = raw_text.rstrip() + continuation
            extracted = _extract_json(merged)

    try:
        parsed = json.loads(extracted)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"JSON parse error: {str(e)[:200]} | Snippet: {extracted[:300]}"
        )

    return ResearchResponse(
        nodes=[ResearchedNode(**n) for n in parsed.get("nodes", [])],
        sources=parsed.get("sources", []),
        notice=parsed.get("notice", "AI-generated from public sources — please verify before use."),
        turns_used=turns_used,
        tokens_cap=RESEARCH_MAX_OUTPUT_TOKENS,
    )


# =============================================================
# GET /research/config  — expose current caps to the frontend
# =============================================================

@router.get("/research/config")
async def research_config():
    return {
        "max_output_tokens": RESEARCH_MAX_OUTPUT_TOKENS,
        "max_search_turns":  RESEARCH_MAX_SEARCH_TURNS,
        "model":             ANTHROPIC_MODEL,
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

    for node in body.nodes:
        dim_type_id = type_map.get(node.category)
        if not dim_type_id:
            continue
        exists = await db.execute(
            text("SELECT 1 FROM twin.dim_node WHERE company_id=:cid AND lower(label)=lower(:label) AND valid_to IS NULL"),
            {"cid": body.company_id, "label": node.label},
        )
        if exists.scalar():
            skipped += 1
            continue
        await db.execute(
            text("""INSERT INTO twin.dim_node
                    (company_id, dim_type_id, label, summary, tags, visibility, sensitive)
                    VALUES (:company_id, :dim_type_id, :label, :summary,
                            cast(:tags as jsonb), :visibility, :sensitive)"""),
            {"company_id": body.company_id, "dim_type_id": dim_type_id,
             "label": node.label, "summary": node.summary,
             "tags": json.dumps(node.tags), "visibility": node.visibility,
             "sensitive": node.sensitive},
        )
        saved += 1

    await db.commit()
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

    for node in template_nodes:
        dim_type_id = type_map.get(node["category"])
        if not dim_type_id:
            continue
        exists = await db.execute(
            text("SELECT 1 FROM twin.dim_node WHERE company_id=:cid AND lower(label)=lower(:label) AND valid_to IS NULL"),
            {"cid": body.company_id, "label": node["label"]},
        )
        if exists.scalar():
            skipped += 1
            continue
        await db.execute(
            text("""INSERT INTO twin.dim_node
                    (company_id, dim_type_id, label, summary, tags, visibility, sensitive)
                    VALUES (:company_id, :dim_type_id, :label, :summary,
                            cast(:tags as jsonb), :visibility, :sensitive)"""),
            {"company_id":  body.company_id,
             "dim_type_id": dim_type_id,
             "label":       node["label"],
             "summary":     node["summary"],
             "tags":        json.dumps(node["tags"]),
             "visibility":  node.get("visibility", "internal"),
             "sensitive":   node.get("sensitive", False)},
        )
        seeded += 1

    await db.commit()
    return {
        "seeded":  seeded,
        "skipped": skipped,
        "message": f"Seeded {seeded} nodes ({skipped} already existed).",
    }


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
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

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
        raise HTTPException(
            status_code=502,
            detail=f"AI returned invalid JSON: {str(e)[:200]}"
        )

    return SuggestDimensionResponse(
        summary=parsed.get("summary", ""),
        tags=parsed.get("tags", []),
    )
