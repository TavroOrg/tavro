from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CURRENT_YEAR = datetime.datetime.now().year

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db, AsyncSessionLocal

router = APIRouter()

ANTHROPIC_API_URL       = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL         = "claude-sonnet-4-6"
SPARK_MAX_TOKENS        = 2000
SPARK_MAX_TOKENS_DIR    = 4000   # direction mode needs room for N structured ideas
SPARK_MAX_IDEAS         = 16
SPARK_DDL_CANDIDATE_PATHS = (
    Path("/sql/core/spark_ideas.sql"),
    Path(__file__).resolve().parents[3] / "sql" / "core" / "spark_ideas.sql",
)


# ── Pydantic models ────────────────────────────────────────────────────────────

class SparkTargetNode(BaseModel):
    id: str
    label: str
    category: str
    summary: str | None = None


class SparkSimilarAgent(BaseModel):
    agent_id: str
    agent_name: str | None


class SparkIdea(BaseModel):
    idea_id: str
    title: str
    description: str
    rationale: str
    signal_type: str
    signal_label: str
    target_dimensions: list[str]
    target_nodes: list[SparkTargetNode]
    complexity: str
    estimated_impact: str
    similar_agents: list[SparkSimilarAgent]


class SparkConvertRequest(BaseModel):
    idea_id: str
    company_id: str
    title: str
    description: str
    rationale: str
    target_dimensions: list[str]
    signal_label: str | None = None
    complexity: str | None = None
    estimated_impact: str | None = None


class SparkConvertResponse(BaseModel):
    use_case_fields: dict
    agent_recommendation: dict | None = None


# ── Table bootstrap ────────────────────────────────────────────────────────────

async def ensure_spark_table() -> None:
    ddl_sql = _load_spark_ddl()
    ddl_statements = [stmt.strip() for stmt in ddl_sql.split(";") if stmt.strip()]
    async with AsyncSessionLocal() as db:
        for stmt in ddl_statements:
            await db.execute(text(stmt))
        await db.commit()


def _load_spark_ddl() -> str:
    for candidate in SPARK_DDL_CANDIDATE_PATHS:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")

    attempted = ", ".join(str(path) for path in SPARK_DDL_CANDIDATE_PATHS)
    raise FileNotFoundError(f"spark_ideas.sql not found. Checked: {attempted}")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _idea_id(node_id: str, signal_type: str, direction: str | None = None) -> str:
    raw = f"{node_id}:{signal_type}"
    if direction:
        raw += f":{direction.strip().lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _extract_json(raw: str) -> str:
    fenced = re.search(r'```(?:json)?[\s\n]*(\[[\s\S]*?\])[\s\n]*```', raw)
    if fenced:
        return fenced.group(1).strip()
    start = raw.find('[')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    return raw[start:i + 1]
    return raw.strip()


def _extract_json_object(raw: str) -> str:
    start = raw.find('{')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return raw[start:i + 1]
    return raw.strip()


async def _call_anthropic(
    api_key: str,
    messages: list[dict],
    system: str,
    max_tokens: int = SPARK_MAX_TOKENS,
) -> dict:
    payload: dict[str, Any] = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   messages,
    }
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
        raise RuntimeError(f"Anthropic {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _basic_idea(_node_id: str, label: str, category: str, summary: str | None, _signal_type: str, signal_label: str) -> dict:
    return {
        "title": f"AI automation for {label}",
        "description": f"Explore AI-driven automation opportunities for the {label} {category}. {summary or ''}".strip(),
        "rationale": signal_label or f"This {category} has no AI coverage — a clear opportunity for automation.",
        "complexity": "Medium",
        "estimated_impact": "Medium",
    }


# ── Gap analysis queries ───────────────────────────────────────────────────────

async def _fetch_dim_node_candidates(
    db: AsyncSession,
    company_id: str,
    categories: list[str],
    signal_type: str,
    signal_label: str,
    limit: int = 5,
) -> list[dict]:
    try:
        async with db.begin_nested():
            rows = await db.execute(text("""
                SELECT dn.id, dn.label, dn.summary, dt.category
                FROM twin.dim_node dn
                JOIN twin.dim_type dt ON dn.dim_type_id = dt.id
                WHERE dn.company_id = :company_id
                  AND dt.category = ANY(:categories)
                ORDER BY RANDOM()
                LIMIT :limit
            """), {"company_id": company_id, "categories": categories, "limit": limit})
            candidates = []
            for row in rows.mappings():
                candidates.append({
                    "node_id": str(row["id"]),
                    "label": row["label"] or "Unnamed",
                    "category": row["category"],
                    "summary": row["summary"],
                    "signal_type": signal_type,
                    "signal_label": signal_label,
                })
            return candidates
    except Exception:
        return []


async def _fetch_agents(db: AsyncSession) -> list[SparkSimilarAgent]:
    try:
        async with db.begin_nested():
            rows = await db.execute(text("""
                SELECT agent_id, role as agent_name
                FROM agents
                LIMIT 50
            """))
            return [SparkSimilarAgent(agent_id=str(r["agent_id"]), agent_name=r["agent_name"]) for r in rows.mappings()]
    except Exception:
        return []


# ── LLM enrichment ─────────────────────────────────────────────────────────────

async def _enrich_with_claude(candidates: list[dict], api_key: str, direction: str | None = None) -> list[dict]:
    signals = [
        {
            "index": i,
            "label": c["label"],
            "category": c["category"],
            "summary": c.get("summary") or "",
            "signal_label": c["signal_label"],
        }
        for i, c in enumerate(candidates)
    ]

    direction_clause = (
        f"\n\nFOCUS DIRECTION (user-specified): \"{direction}\"\n"
        "All ideas MUST be relevant to this focus area. If a signal is not naturally connected to it, "
        "find the angle that links it — do not generate an off-topic idea just to fill the slot."
    ) if direction and direction.strip() else ""

    system = (
        f"You are a senior AI implementation consultant specialising in manufacturing operations. "
        f"Your job is to identify specific, high-ROI AI agent ideas that can realistically be built and deployed in 3–18 months. "
        f"Today's year is {CURRENT_YEAR}. "
        f"NEVER reference goals, targets, revenue plans, or milestones tied to years before {CURRENT_YEAR}. "
        f"If a signal mentions a past-year goal (e.g. FY2024, FY2025), ignore the goal framing and focus on the underlying system or process instead."
        f"{direction_clause}\n\n"
        "A GOOD idea:\n"
        "  • Names one specific AI capability — anomaly detection, document extraction, predictive classification, NLP triage, demand forecasting, quality inspection, work order routing, root-cause analysis, etc.\n"
        "  • References the exact system or process in the context (use its label and category)\n"
        "  • Describes concretely what input data flows in and what specific output or decision is produced\n"
        "  • States a measurable ROI hook: hours saved per week, defect rate reduction, cost avoidance, decision speed-up\n"
        "  • Is achievable by a small team (2–5 engineers) using current AI APIs and tools\n\n"
        "A BAD idea (never generate these):\n"
        "  • Vague: 'leverage AI', 'harness machine learning', 'build an AI platform', 'explore opportunities'\n"
        "  • Time-expired: references FY2024, FY2025, or any past-year target\n"
        "  • Scope-inflated: describes a full enterprise programme with no specific agent\n"
        "  • Disconnected: idea has no real link to the specific system named in the context signal"
    )
    user = (
        "For each signal below, generate ONE specific AI agent idea as a JSON object with exactly these fields:\n"
        "- title: specific agent name, max 8 words "
        "(good: 'MES Downtime Root-Cause Classifier'; bad: 'AI for Manufacturing Operations')\n"
        "- description: exactly 2 sentences — "
        "sentence 1: what the agent does and which specific system/process it connects to; "
        "sentence 2: what output it produces and how a user or downstream system acts on it\n"
        "- rationale: 1 sentence — the specific ROI or risk reduction, quantified where possible "
        "(e.g. 'saves ~6 hrs/week of manual triage', 'reduces scrap rate by ~15%', 'cuts invoice processing from 3 days to 4 hours')\n"
        "- complexity: exactly one of 'Low', 'Medium', or 'High'\n"
        "  Low = uses existing AI APIs with no custom training, deployable in <8 weeks\n"
        "  Medium = requires fine-tuning, custom pipeline, or multi-system integration, 2–6 months\n"
        "  High = real-time ML, on-premise OT integration, or significant data engineering, 6–18 months\n"
        "- estimated_impact: exactly one of 'Low', 'Medium', or 'High'\n"
        "  High = saves >$50K/yr or prevents critical production or compliance risk\n"
        "  Medium = saves $10–50K/yr or eliminates significant manual work\n"
        "  Low = incremental improvement, <$10K/yr\n\n"
        f"Signals:\n{json.dumps(signals, indent=2)}\n\n"
        "Return ONLY a JSON array with one object per signal, same order. No prose, no markdown fences."
    )

    try:
        data = await _call_anthropic(api_key, [{"role": "user", "content": user}], system)
        raw_text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                raw_text += block.get("text", "")
        enriched = json.loads(_extract_json(raw_text))
        if isinstance(enriched, list) and len(enriched) == len(candidates):
            return enriched
    except Exception as exc:
        logger.error("_enrich_with_claude failed — falling back to basic ideas: %s", exc)

    return [_basic_idea(c["node_id"], c["label"], c["category"], c.get("summary"), c["signal_type"], c["signal_label"]) for c in candidates]


async def _build_ideas(unique: list[dict], all_agents: list[SparkSimilarAgent], api_key: str, direction: str | None = None) -> list[SparkIdea]:
    if api_key:
        enriched = await _enrich_with_claude(unique, api_key, direction=direction)
    else:
        enriched = [_basic_idea(c["node_id"], c["label"], c["category"], c.get("summary"), c["signal_type"], c["signal_label"]) for c in unique]

    ideas: list[SparkIdea] = []
    for i, candidate in enumerate(unique):
        e = enriched[i] if i < len(enriched) else {}
        ideas.append(SparkIdea(
            idea_id=_idea_id(candidate["node_id"], candidate["signal_type"], direction),
            title=e.get("title") or f"AI automation for {candidate['label']}",
            description=e.get("description") or "",
            rationale=e.get("rationale") or candidate["signal_label"],
            signal_type=candidate["signal_type"],
            signal_label=candidate["signal_label"],
            target_dimensions=[candidate["category"]],
            target_nodes=[SparkTargetNode(
                id=candidate["node_id"],
                label=candidate["label"],
                category=candidate["category"],
                summary=candidate.get("summary"),
            )],
            complexity=e.get("complexity", "Medium"),
            estimated_impact=e.get("estimated_impact", "Medium"),
            similar_agents=all_agents[:2],
        ))
    return ideas


async def _fetch_all_company_nodes(db: AsyncSession, company_id: str, limit: int = 40) -> list[dict]:
    """Fetch company nodes to use as background context for direction-focused generation."""
    try:
        async with db.begin_nested():
            rows = await db.execute(text("""
                SELECT dn.label, dn.summary, dt.category
                FROM twin.dim_node dn
                JOIN twin.dim_type dt ON dn.dim_type_id = dt.id
                WHERE dn.company_id = :company_id
                ORDER BY dt.category, dn.label
                LIMIT :limit
            """), {"company_id": company_id, "limit": limit})
            return [
                {
                    "label": row["label"] or "Unnamed",
                    "category": row["category"],
                    "summary": (row["summary"] or "")[:200],
                }
                for row in rows.mappings()
            ]
    except Exception:
        return []


async def _generate_direction_ideas(
    company_nodes: list[dict],
    api_key: str,
    direction: str,
    count: int = SPARK_MAX_IDEAS,
) -> list[SparkIdea]:
    """Direction-first generation: Claude produces ideas about the topic using company context."""
    context_lines = "\n".join(
        f"  [{c['category'].upper()}] {c['label']}"
        + (f": {c['summary']}" if c.get("summary") else "")
        for c in company_nodes
    )

    system = (
        f"You are a senior AI implementation consultant specialising in manufacturing operations. "
        f"Today's year is {CURRENT_YEAR}. Never reference past-year goals or stale targets. "
        "Generate specific, concrete, buildable AI agent ideas with measurable ROI. "
        "Each idea must name one specific AI capability — not vague phrases like 'leverage AI'."
    )

    user = (
        f"FOCUS: Generate exactly {count} distinct AI agent ideas, ALL specifically about: \"{direction}\"\n\n"
        f"Company context (systems, processes, and integrations — reference them where applicable):\n"
        f"{context_lines}\n\n"
        "For each idea return a JSON object with:\n"
        "- title: specific agent name, max 8 words "
        "(good: 'OData Quality Gate Anomaly Detector'; bad: 'AI for OData')\n"
        "- description: exactly 2 sentences — "
        "sentence 1: what the agent does and which system/integration it connects to; "
        "sentence 2: what output it produces and how it is acted on\n"
        "- rationale: 1 sentence — specific ROI, quantified where possible "
        "(e.g. 'reduces manual data reconciliation by ~4 hrs/week')\n"
        "- complexity: exactly 'Low', 'Medium', or 'High'\n"
        "- estimated_impact: exactly 'Low', 'Medium', or 'High'\n"
        "- category: one of: process, integration, application, risk, strategy\n\n"
        f"ALL {count} ideas MUST be about \"{direction}\". "
        "Return ONLY a JSON array. No prose, no markdown fences."
    )

    try:
        data = await _call_anthropic(
            api_key,
            [{"role": "user", "content": user}],
            system,
            max_tokens=SPARK_MAX_TOKENS_DIR,
        )
        raw_text = "".join(
            block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"
        )
        enriched = json.loads(_extract_json(raw_text))
        if not isinstance(enriched, list):
            raise ValueError("non-list response")

        ideas: list[SparkIdea] = []
        for i, e in enumerate(enriched[:count]):
            category = e.get("category", "process")
            signal_type = "integration_surface" if category in ("integration", "application") else "gap_coverage"
            node_id = f"dir:{hashlib.sha256(f'{direction}:{i}'.encode()).hexdigest()[:8]}"
            ideas.append(SparkIdea(
                idea_id=_idea_id(node_id, signal_type, direction),
                title=e.get("title") or f"AI for {direction}",
                description=e.get("description") or "",
                rationale=e.get("rationale") or "",
                signal_type=signal_type,
                signal_label=f"Focus: {direction.strip()}",
                target_dimensions=[category],
                target_nodes=[],
                complexity=e.get("complexity", "Medium"),
                estimated_impact=e.get("estimated_impact", "Medium"),
                similar_agents=[],
            ))
        return ideas
    except Exception as exc:
        logger.error("_generate_direction_ideas failed: %s", exc)
        return []


async def _collect_candidates(db: AsyncSession, company_id: str, dim_filter: list[str]) -> list[dict]:
    candidates: list[dict] = []
    active_signals = dim_filter or ["process", "risk", "strategy", "application", "integration"]

    if "process" in active_signals:
        candidates += await _fetch_dim_node_candidates(db, company_id, ["process"], "gap_coverage", "Process with no AI coverage", limit=6)

    if "risk" in active_signals:
        candidates += await _fetch_dim_node_candidates(db, company_id, ["risk"], "risk_hotspot", "Risk area with no monitoring agent", limit=4)

    if "strategy" in active_signals or "finance" in active_signals:
        strat_cats = [c for c in ["strategy", "finance"] if c in active_signals or not dim_filter]
        if strat_cats:
            candidates += await _fetch_dim_node_candidates(db, company_id, strat_cats, "strategic_gap", "Strategic or financial area with AI potential", limit=4)

    if "application" in active_signals:
        candidates += await _fetch_dim_node_candidates(db, company_id, ["application"], "integration_surface", "Application with no AI agent integration", limit=6)

    if "integration" in active_signals:
        candidates += await _fetch_dim_node_candidates(db, company_id, ["integration"], "integration_surface", "Integration surface with no agent coverage", limit=6)

    seen: set[str] = set()
    unique: list[dict] = []
    for c in candidates:
        if c["node_id"] not in seen:
            seen.add(c["node_id"])
            unique.append(c)

    return unique[:SPARK_MAX_IDEAS]


async def _upsert_ideas(company_id: str, ideas: list[SparkIdea]) -> None:
    """Persist ideas in an isolated session so read-query failures can't poison the write."""
    async with AsyncSessionLocal() as db:
        try:
            for idea in ideas:
                await db.execute(text("""
                    INSERT INTO core.spark_ideas (
                        idea_id, company_id, title, description, rationale,
                        signal_type, signal_label, target_dimensions,
                        target_nodes, complexity, estimated_impact, similar_agents, updated_at
                    ) VALUES (
                        :idea_id, :company_id, :title, :description, :rationale,
                        :signal_type, :signal_label, :target_dimensions,
                        CAST(:target_nodes AS jsonb), :complexity, :estimated_impact, CAST(:similar_agents AS jsonb), NOW()
                    )
                    ON CONFLICT (idea_id) DO UPDATE SET
                        company_id        = EXCLUDED.company_id,
                        title             = EXCLUDED.title,
                        description       = EXCLUDED.description,
                        rationale         = EXCLUDED.rationale,
                        signal_type       = EXCLUDED.signal_type,
                        signal_label      = EXCLUDED.signal_label,
                        target_dimensions = EXCLUDED.target_dimensions,
                        target_nodes      = EXCLUDED.target_nodes,
                        complexity        = EXCLUDED.complexity,
                        estimated_impact  = EXCLUDED.estimated_impact,
                        similar_agents    = EXCLUDED.similar_agents,
                        updated_at        = NOW()
                """), {
                    "idea_id":           idea.idea_id,
                    "company_id":        company_id,
                    "title":             idea.title,
                    "description":       idea.description,
                    "rationale":         idea.rationale,
                    "signal_type":       idea.signal_type,
                    "signal_label":      idea.signal_label,
                    "target_dimensions": idea.target_dimensions,
                    "target_nodes":      json.dumps([n.model_dump() for n in idea.target_nodes]),
                    "complexity":        idea.complexity,
                    "estimated_impact":  idea.estimated_impact,
                    "similar_agents":    json.dumps([a.model_dump() for a in idea.similar_agents]),
                })
            await db.commit()
        except Exception:
            await db.rollback()
            raise


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/ideas", response_model=list[SparkIdea])
async def get_spark_ideas(
    company_id: str = Query(..., description="Company UUID"),
    search: str | None = Query(None, description="Free-text search across title and description"),
    db: AsyncSession = Depends(get_db),
) -> list[SparkIdea]:
    """Return stored ideas for a company. Optionally filter by search term."""
    params: dict[str, Any] = {"company_id": company_id}
    where = "company_id = :company_id"
    if search and search.strip():
        where += " AND (title ILIKE :search OR description ILIKE :search OR rationale ILIKE :search)"
        params["search"] = f"%{search.strip()}%"

    rows = await db.execute(text(f"""
        SELECT idea_id, title, description, rationale, signal_type, signal_label,
               target_dimensions, target_nodes, complexity, estimated_impact, similar_agents
        FROM core.spark_ideas
        WHERE {where}
        ORDER BY updated_at DESC
    """), params)

    result: list[SparkIdea] = []
    for r in rows.mappings():
        result.append(SparkIdea(
            idea_id=r["idea_id"],
            title=r["title"],
            description=r["description"] or "",
            rationale=r["rationale"] or "",
            signal_type=r["signal_type"] or "gap_coverage",
            signal_label=r["signal_label"] or "",
            target_dimensions=list(r["target_dimensions"] or []),
            target_nodes=[SparkTargetNode(**n) for n in (r["target_nodes"] or [])],
            complexity=r["complexity"] or "Medium",
            estimated_impact=r["estimated_impact"] or "Medium",
            similar_agents=[SparkSimilarAgent(**a) for a in (r["similar_agents"] or [])],
        ))
    return result


@router.delete("/ideas", status_code=204)
async def reset_spark_ideas(
    company_id: str = Query(..., description="Company UUID"),
    idea_ids: str | None = Query(None, description="Comma-separated idea IDs to delete. Omit to delete all ideas for the company."),
) -> None:
    """Delete Spark ideas. Pass idea_ids to remove specific ones, or omit to wipe all for the company."""
    async with AsyncSessionLocal() as db:
        if idea_ids:
            ids = [i.strip() for i in idea_ids.split(",") if i.strip()]
            if ids:
                placeholders = ", ".join(f":id_{i}" for i in range(len(ids)))
                params: dict = {"company_id": company_id}
                params.update({f"id_{i}": v for i, v in enumerate(ids)})
                await db.execute(
                    text(f"DELETE FROM core.spark_ideas WHERE company_id = :company_id AND idea_id IN ({placeholders})"),
                    params,
                )
        else:
            await db.execute(
                text("DELETE FROM core.spark_ideas WHERE company_id = :company_id"),
                {"company_id": company_id},
            )
        await db.commit()


@router.post("/generate", response_model=list[SparkIdea])
async def generate_spark_ideas(
    company_id: str = Query(..., description="Company UUID"),
    dimensions: str | None = Query(None, description="Comma-separated dimension filter"),
    direction: str | None = Query(None, description="User-specified focus area (e.g. 'Quality management')"),
    db: AsyncSession = Depends(get_db),
) -> list[SparkIdea]:
    """Generate fresh ideas from company context, persist to DB, return them."""
    dim_filter = [d.strip() for d in dimensions.split(",")] if dimensions else []
    direction_clean = direction.strip() if direction and direction.strip() else None
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    if direction_clean and api_key:
        # Direction mode: Claude generates ideas *about* the topic using all company nodes as context.
        # Does not depend on which nodes happen to be randomly selected.
        company_nodes = await _fetch_all_company_nodes(db, company_id)
        ideas = await _generate_direction_ideas(company_nodes, api_key, direction_clean)
        if not ideas:
            # Fallback to normal flow if direction generation fails
            unique = await _collect_candidates(db, company_id, dim_filter)
            all_agents = await _fetch_agents(db)
            ideas = await _build_ideas(unique, all_agents, api_key, direction=direction_clean)
    else:
        unique = await _collect_candidates(db, company_id, dim_filter)
        if not unique:
            return []
        all_agents = await _fetch_agents(db)
        ideas = await _build_ideas(unique, all_agents, api_key)

    if not ideas:
        return []

    # Without direction: delete-all first for a fresh general refresh.
    # With direction: accumulate — each focus area adds to the library.
    if not direction_clean:
        async with AsyncSessionLocal() as clear_db:
            await clear_db.execute(
                text("DELETE FROM core.spark_ideas WHERE company_id = :company_id"),
                {"company_id": company_id},
            )
            await clear_db.commit()

    await _upsert_ideas(company_id, ideas)
    return ideas


@router.post("/convert", response_model=SparkConvertResponse)
async def convert_idea(request: SparkConvertRequest) -> SparkConvertResponse:
    """Expand a Spark idea into full AI use case fields via Claude."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    priority_map = {"Low": "4 - Low", "Medium": "3 - Moderate", "High": "2 - High"}
    priority = priority_map.get(request.estimated_impact or "Medium", "3 - Moderate")

    if not api_key:
        return SparkConvertResponse(use_case_fields={
            "title": request.title,
            "description": request.description,
            "business_problem_statement": request.rationale,
            "expected_benefits": f"AI-driven improvements for: {request.title}",
            "priority": priority,
            "solution_approach": "",
        })

    system = (
        "You are an AI governance expert who writes structured AI use case documentation. "
        "Be specific, actionable, and business-focused. No filler phrases."
    )
    user = (
        "Expand this Spark idea into a complete AI use case record.\n\n"
        f"Idea title: {request.title}\n"
        f"Description: {request.description}\n"
        f"Rationale: {request.rationale}\n"
        f"Context: {request.signal_label or ''}\n"
        f"Dimensions: {', '.join(request.target_dimensions)}\n\n"
        "Return a single JSON object with exactly these fields:\n"
        "- title: formal use case name (keep close to the idea title)\n"
        "- description: 3-4 sentence overview of the AI use case and how it works\n"
        "- business_problem_statement: the specific business problem or gap being addressed\n"
        "- expected_benefits: concrete outcomes (efficiency %, cost reduction, risk reduction, etc.)\n"
        "- solution_approach: brief technical approach (model type, data sources, integration points)\n"
        f"- priority: exactly one of '1 - Critical', '2 - High', '3 - Moderate', '4 - Low', '5 - Planning' (suggest '{priority}' based on impact)\n\n"
        "Return ONLY the JSON object. No prose, no markdown fencing."
    )

    try:
        data = await _call_anthropic(api_key, [{"role": "user", "content": user}], system, max_tokens=1000)
        raw_text = "".join(
            block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"
        )
        fields = json.loads(_extract_json_object(raw_text))
        if not isinstance(fields, dict):
            raise ValueError("Non-dict response")
    except Exception:
        fields = {
            "title": request.title,
            "description": request.description,
            "business_problem_statement": request.rationale,
            "expected_benefits": f"AI-driven improvements for: {request.title}",
            "solution_approach": "",
        }

    fields.setdefault("priority", priority)

    def _to_str(v: Any) -> str:
        if isinstance(v, list):
            return ", ".join(str(i) for i in v)
        return str(v) if v is not None else ""

    safe_fields = {k: _to_str(v) for k, v in fields.items()}

    # Second Claude call: design the agent that implements this use case
    agent_rec = None
    if api_key:
        agent_system = (
            "You are an AI solutions architect. Design a specific AI agent that implements the given use case. "
            "Be concrete about what tools (APIs, systems, integrations) the agent needs and what data it reads."
        )
        agent_user = (
            f"Design an AI agent that implements this use case:\n"
            f"Title: {request.title}\n"
            f"Description: {fields.get('description', request.description)}\n"
            f"Solution approach: {fields.get('solution_approach', '')}\n"
            f"Dimensions: {', '.join(request.target_dimensions)}\n\n"
            "Return a JSON object with exactly these fields:\n"
            "- agent_name: concise agent name, max 6 words\n"
            "- description: 1–2 sentences on what the agent does\n"
            "- instruction: 3–5 sentences of operational instructions — how it ingests data, what it produces, and when it acts\n"
            "- tools: list of up to 4 objects {\"name\": \"...\", \"description\": \"...\"} — the external systems/APIs this agent calls (use real system names if mentioned in the use case, otherwise use descriptive generic names)\n"
            "- knowledge_source: one object {\"name\": \"...\", \"description\": \"...\"} — the primary data source the agent reads from\n\n"
            "Return ONLY the JSON object. No prose."
        )
        try:
            agent_data = await _call_anthropic(api_key, [{"role": "user", "content": agent_user}], agent_system, max_tokens=600)
            agent_raw = "".join(
                block.get("text", "") for block in agent_data.get("content", []) if block.get("type") == "text"
            )
            agent_rec = json.loads(_extract_json_object(agent_raw))
            if not isinstance(agent_rec, dict):
                agent_rec = None
        except Exception:
            agent_rec = None

    return SparkConvertResponse(use_case_fields=safe_fields, agent_recommendation=agent_rec)
