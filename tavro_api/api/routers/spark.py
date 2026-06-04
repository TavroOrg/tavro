from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

CURRENT_YEAR = datetime.datetime.now().year

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
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
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
    if fenced:
        fenced_payload = fenced.group(1).strip()
        extracted = _extract_balanced_json(fenced_payload, "[", "]")
        if extracted is not None:
            return extracted

    extracted = _extract_balanced_json(raw, "[", "]")
    if extracted is not None:
        return extracted
    return raw.strip()


def _extract_json_object(raw: str) -> str:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
    if fenced:
        fenced_payload = fenced.group(1).strip()
        extracted = _extract_balanced_json(fenced_payload, "{", "}")
        if extracted is not None:
            return extracted

    extracted = _extract_balanced_json(raw, "{", "}")
    if extracted is not None:
        return extracted
    return raw.strip()


def _extract_balanced_json(raw: str, opening: str, closing: str) -> str | None:
    depth = 0
    start_idx = -1
    in_string = False
    escaped = False

    for i, ch in enumerate(raw):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == opening:
            if depth == 0:
                start_idx = i
            depth += 1
            continue

        if ch == closing and depth > 0:
            depth -= 1
            if depth == 0 and start_idx != -1:
                return raw[start_idx:i + 1]

    return None


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


async def _stream_anthropic(
    api_key: str,
    messages: list[dict],
    system: str,
    max_tokens: int = SPARK_MAX_TOKENS,
) -> AsyncGenerator[str, None]:
    """Yield raw text delta chunks from Anthropic's streaming API."""
    payload: dict[str, Any] = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   messages,
        "stream":     True,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            ANTHROPIC_API_URL,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(f"Anthropic {resp.status_code}: {body.decode()[:300]}")
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "content_block_delta":
                            text_chunk = data.get("delta", {}).get("text", "")
                            if text_chunk:
                                yield text_chunk
                    except json.JSONDecodeError:
                        pass


def _extract_complete_objects(buffer: str) -> tuple[list[dict], str]:
    """
    Parse any complete JSON objects out of a streaming buffer.
    Returns (list_of_parsed_objects, remaining_unparsed_buffer).
    Handles arrays like [{...}, {...}] arriving token by token.
    """
    objects: list[dict] = []
    i = 0
    n = len(buffer)

    # Skip preamble to find '[' or '{'
    while i < n and buffer[i] not in "[{":
        i += 1
    if i >= n:
        return objects, buffer

    # Consume the opening '[' of an array
    if buffer[i] == "[":
        i += 1

    while i < n:
        # Skip whitespace and commas between objects
        while i < n and buffer[i] in " \t\n\r,":
            i += 1
        if i >= n:
            break
        if buffer[i] == "]":
            return objects, ""
        if buffer[i] != "{":
            break

        # Track depth to find the matching '}'
        depth = 0
        in_string = False
        escape_next = False
        obj_start = i
        j = i

        while j < n:
            c = buffer[j]
            if escape_next:
                escape_next = False
            elif c == "\\" and in_string:
                escape_next = True
            elif c == '"':
                in_string = not in_string
            elif not in_string:
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(buffer[obj_start : j + 1])
                            objects.append(obj)
                        except json.JSONDecodeError:
                            pass
                        i = j + 1
                        break
            j += 1
        else:
            # Incomplete object — keep from obj_start for next chunk
            return objects, buffer[obj_start:]

    return objects, buffer[i:] if i < n else ""


def _build_direction_prompt(company_nodes: list[dict], direction: str, count: int) -> tuple[str, str]:
    """Return (system, user) prompts for direction-mode idea generation."""
    context_lines = "\n".join(
        f"  [{c['category'].upper()}] {c['label']}"
        + (f": {c['summary']}" if c.get("summary") else "")
        for c in company_nodes
    )
    system = (
        f"You are a senior AI implementation consultant specialising in manufacturing operations. "
        f"Today's year is {CURRENT_YEAR}. Never reference past-year goals or stale targets. "
        "Generate specific, concrete, buildable AI use case ideas with measurable ROI. "
        "Do not generate agents here. Do not include agent names in titles. "
        "Each idea must name one specific AI capability — not vague phrases like 'leverage AI'."
    )
    user = (
        f"FOCUS: Generate exactly {count} distinct AI use case ideas, ALL specifically about: \"{direction}\"\n\n"
        f"Company context (systems, processes, and integrations — reference them where applicable):\n"
        f"{context_lines}\n\n"
        "For each idea return a JSON object with:\n"
        "- title: formal AI use case title, max 8 words. "
        "Do NOT include the word 'Agent'. Do NOT write an agent name. "
        "(good: 'OData Quality Gate Anomaly Detection'; bad: 'OData Quality Gate Agent')\n"
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
    return system, user


def _basic_idea(_node_id: str, label: str, category: str, summary: str | None, _signal_type: str, signal_label: str) -> dict:
    return {
        "title": f"AI automation for {label}",
        "description": f"Explore AI-driven automation opportunities for the {label} {category}. {summary or ''}".strip(),
        "rationale": signal_label or f"This {category} has no AI coverage — a clear opportunity for automation.",
        "complexity": "Medium",
        "estimated_impact": "Medium",
    }


# ── Gap analysis queries ───────────────────────────────────────────────────────

def _to_text(value: Any, default: str = "") -> str:
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value if v is not None)
    text = str(value) if value is not None else ""
    text = re.sub(r"\s+", " ", text).strip()
    return text or default


def _to_agent_name(seed: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", seed)
    if not words:
        return "Spark Use Case Agent"

    base = words[:6]
    if "agent" not in {w.lower() for w in base}:
        base = (words[:5] if len(words) >= 5 else words[:]) + ["Agent"]
    return " ".join(base[:6])


def _sanitize_tools(tools: Any) -> list[dict[str, str]]:
    if not isinstance(tools, list):
        return []

    cleaned: list[dict[str, str]] = []
    for item in tools:
        if not isinstance(item, dict):
            continue
        name = _to_text(item.get("name"))
        if not name:
            continue
        desc = _to_text(item.get("description"), f"Integration with {name}")
        cleaned.append({"name": name, "description": desc})
    return cleaned[:4]


def _sanitize_knowledge_source(source: Any) -> dict[str, str] | None:
    if not isinstance(source, dict):
        return None
    name = _to_text(source.get("name"))
    if not name:
        return None
    return {
        "name": name,
        "description": _to_text(source.get("description"), f"Primary knowledge source for {name}"),
    }


def _fallback_agent_recommendation(request: SparkConvertRequest, fields: dict[str, Any]) -> dict[str, Any]:
    use_case_title = _to_text(fields.get("title"), request.title)
    use_case_desc = _to_text(fields.get("description"), request.description)
    dimensions = [d for d in request.target_dimensions if _to_text(d)]
    dim_text = ", ".join(dimensions) if dimensions else "process"
    context_label = _to_text(request.signal_label, dim_text)

    return {
        "agent_name": _to_agent_name(use_case_title),
        "description": (
            f"Executes the '{use_case_title}' use case by analyzing {context_label.lower()} signals, "
            "surfacing prioritized actions, and tracking outcomes."
        ),
        "instruction": (
            f"Monitor operational data relevant to {use_case_title} and identify high-priority events. "
            "Correlate findings with business context and produce actionable recommendations with rationale. "
            "Trigger alerts when confidence thresholds are met and persist decision traces for governance review. "
            "Escalate uncertain or high-impact cases to human owners and incorporate feedback in future runs."
        ),
        "tools": [
            {
                "name": "Use Case Catalog API",
                "description": "Read and update AI use case metadata, status, and relationship context.",
            },
            {
                "name": "Operational Data API",
                "description": f"Fetch source records and event signals for {dim_text} workflows.",
            },
            {
                "name": "Notification Service",
                "description": "Send prioritized alerts and workflow tasks to relevant stakeholders.",
            },
        ],
        "knowledge_source": {
            "name": "Company Blueprint Context",
            "description": f"Spark context for {use_case_title}: {use_case_desc or request.rationale}",
        },
    }


def _normalize_agent_recommendation(
    candidate: Any,
    request: SparkConvertRequest,
    fields: dict[str, Any],
) -> dict[str, Any]:
    fallback = _fallback_agent_recommendation(request, fields)
    if not isinstance(candidate, dict):
        return fallback

    result = dict(fallback)

    name = _to_text(candidate.get("agent_name"))
    if name:
        result["agent_name"] = _to_agent_name(name)

    description = _to_text(candidate.get("description"))
    if description:
        result["description"] = description

    instruction = _to_text(candidate.get("instruction"))
    if instruction:
        result["instruction"] = instruction

    tools = _sanitize_tools(candidate.get("tools"))
    if tools:
        result["tools"] = tools

    knowledge_source = _sanitize_knowledge_source(candidate.get("knowledge_source"))
    if knowledge_source:
        result["knowledge_source"] = knowledge_source

    return result


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

def _build_gap_prompt(candidates: list[dict], direction: str | None = None) -> tuple[str, str]:
    """Return (system, user) prompts for gap-analysis idea generation."""
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
        f"Your job is to identify specific, high-ROI AI use case ideas that can realistically be implemented in 3–18 months. "
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
        "For each signal below, generate ONE specific AI use case idea as a JSON object with exactly these fields:\n"
        "- title: formal AI use case title, max 8 words. "
        "Do NOT include the word 'Agent'. Do NOT write an agent name. "
        "(good: 'MES Downtime Root-Cause Classification'; bad: 'MES Downtime Agent')\n"
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
    return system, user


async def _enrich_with_claude(candidates: list[dict], api_key: str, direction: str | None = None) -> list[dict]:
    system, user = _build_gap_prompt(candidates, direction)
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
    system, user = _build_direction_prompt(company_nodes, direction, count)

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


@router.post("/generate/stream")
async def generate_spark_ideas_stream(
    company_id: str = Query(..., description="Company UUID"),
    dimensions: str | None = Query(None, description="Comma-separated dimension filter"),
    direction: str | None = Query(None, description="User-specified focus area"),
    db: AsyncSession = Depends(get_db),
):
    """
    SSE stream of spark ideas.
    Both direction mode and gap-analysis mode emit 'idea' events progressively
    as each object is parsed from the Anthropic token stream.
    Always ends with a 'done' event (or 'error' on failure).
    """
    dim_filter = [d.strip() for d in dimensions.split(",")] if dimensions else []
    direction_clean = direction.strip() if direction and direction.strip() else None
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    async def event_stream() -> AsyncGenerator[str, None]:
        collected: list[SparkIdea] = []
        try:
            if direction_clean and api_key:
                company_nodes = await _fetch_all_company_nodes(db, company_id)
                count = SPARK_MAX_IDEAS
                system, user = _build_direction_prompt(company_nodes, direction_clean, count)

                buffer = ""
                async for chunk in _stream_anthropic(
                    api_key,
                    [{"role": "user", "content": user}],
                    system,
                    SPARK_MAX_TOKENS_DIR,
                ):
                    buffer += chunk
                    new_objects, buffer = _extract_complete_objects(buffer)
                    for obj in new_objects:
                        category = obj.get("category", "process")
                        signal_type = "integration_surface" if category in ("integration", "application") else "gap_coverage"
                        node_id = f"dir:{hashlib.sha256(f'{direction_clean}:{len(collected)}'.encode()).hexdigest()[:8]}"
                        idea = SparkIdea(
                            idea_id=_idea_id(node_id, signal_type, direction_clean),
                            title=obj.get("title") or f"AI for {direction_clean}",
                            description=obj.get("description") or "",
                            rationale=obj.get("rationale") or "",
                            signal_type=signal_type,
                            signal_label=f"Focus: {direction_clean.strip()}",
                            target_dimensions=[category],
                            target_nodes=[],
                            complexity=obj.get("complexity", "Medium"),
                            estimated_impact=obj.get("estimated_impact", "Medium"),
                            similar_agents=[],
                        )
                        collected.append(idea)
                        yield f"event: idea\ndata: {idea.model_dump_json()}\n\n"

            else:
                # Gap-analysis mode: stream ideas as each enriched object arrives
                unique = await _collect_candidates(db, company_id, dim_filter)
                if unique:
                    all_agents = await _fetch_agents(db)

                    if api_key:
                        system, user = _build_gap_prompt(unique)
                        buffer = ""
                        obj_index = 0
                        async for chunk in _stream_anthropic(
                            api_key,
                            [{"role": "user", "content": user}],
                            system,
                        ):
                            buffer += chunk
                            new_objects, buffer = _extract_complete_objects(buffer)
                            for obj in new_objects:
                                if obj_index >= len(unique):
                                    break
                                candidate = unique[obj_index]
                                obj_index += 1
                                idea = SparkIdea(
                                    idea_id=_idea_id(candidate["node_id"], candidate["signal_type"], None),
                                    title=obj.get("title") or f"AI automation for {candidate['label']}",
                                    description=obj.get("description") or "",
                                    rationale=obj.get("rationale") or candidate["signal_label"],
                                    signal_type=candidate["signal_type"],
                                    signal_label=candidate["signal_label"],
                                    target_dimensions=[candidate["category"]],
                                    target_nodes=[SparkTargetNode(
                                        id=candidate["node_id"],
                                        label=candidate["label"],
                                        category=candidate["category"],
                                        summary=candidate.get("summary"),
                                    )],
                                    complexity=obj.get("complexity", "Medium"),
                                    estimated_impact=obj.get("estimated_impact", "Medium"),
                                    similar_agents=all_agents[:2],
                                )
                                collected.append(idea)
                                yield f"event: idea\ndata: {idea.model_dump_json()}\n\n"
                    else:
                        # No API key — emit basic fallback ideas immediately
                        for candidate in unique:
                            e = _basic_idea(candidate["node_id"], candidate["label"], candidate["category"], candidate.get("summary"), candidate["signal_type"], candidate["signal_label"])
                            idea = SparkIdea(
                                idea_id=_idea_id(candidate["node_id"], candidate["signal_type"], None),
                                title=e["title"],
                                description=e["description"],
                                rationale=e["rationale"],
                                signal_type=candidate["signal_type"],
                                signal_label=candidate["signal_label"],
                                target_dimensions=[candidate["category"]],
                                target_nodes=[SparkTargetNode(
                                    id=candidate["node_id"],
                                    label=candidate["label"],
                                    category=candidate["category"],
                                    summary=candidate.get("summary"),
                                )],
                                complexity="Medium",
                                estimated_impact="Medium",
                                similar_agents=all_agents[:2],
                            )
                            collected.append(idea)
                            yield f"event: idea\ndata: {idea.model_dump_json()}\n\n"

            # Persist to DB
            if collected:
                if not direction_clean:
                    async with AsyncSessionLocal() as clear_db:
                        await clear_db.execute(
                            text("DELETE FROM core.spark_ideas WHERE company_id = :company_id"),
                            {"company_id": company_id},
                        )
                        await clear_db.commit()
                await _upsert_ideas(company_id, collected)

            yield "event: done\ndata: {}\n\n"

        except Exception as exc:
            logger.error("[spark/stream] %s", exc)
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/convert", response_model=SparkConvertResponse)
async def convert_idea(request: SparkConvertRequest) -> SparkConvertResponse:
    """Expand a Spark idea into full AI use case fields via Claude."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    priority_map = {"Low": "4 - Low", "Medium": "3 - Moderate", "High": "2 - High"}
    priority = priority_map.get(request.estimated_impact or "Medium", "3 - Moderate")

    if not api_key:
        no_llm_fields = {
            "title": request.title,
            "description": request.description,
            "business_problem_statement": request.rationale,
            "expected_benefits": f"AI-driven improvements for: {request.title}",
            "priority": priority,
            "solution_approach": "",
        }
        return SparkConvertResponse(
            use_case_fields=no_llm_fields,
            agent_recommendation=_fallback_agent_recommendation(request, no_llm_fields),
        )

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
        "- title: formal business AI use case name. Do NOT include the word 'Agent'. Do NOT write an agent name. Keep close to the idea title.\n"
        "- description: 3-4 sentence overview of the AI use case and how it works\n"
        "- business_problem_statement: the specific business problem or gap being addressed\n"
        "- expected_benefits: plain text paragraph describing concrete outcomes (efficiency %, cost reduction, risk reduction, etc.). Must be a plain string — no JSON objects, no curly braces.\n"
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
    except Exception as exc:
        logger.warning("spark.convert_idea use-case expansion fallback: %s", exc)
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

    def _strip_curly_braces(s: str) -> str:
        s = s.strip()
        while s.startswith("{") and s.endswith("}"):
            s = s[1:-1].strip()
        return s

    safe_fields = {k: _strip_curly_braces(_to_str(v)) for k, v in fields.items()}

    # Second Claude call: design the agent that implements this use case
    agent_rec: dict[str, Any] | None = None
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
            agent_data = await _call_anthropic(api_key, [{"role": "user", "content": agent_user}], agent_system, max_tokens=1200)
            agent_raw = "".join(block.get("text", "") for block in agent_data.get("content", []) if block.get("type") == "text")
            extracted_agent = _extract_json_object(agent_raw)

            if agent_data.get("stop_reason") == "max_tokens" and _extract_balanced_json(extracted_agent, "{", "}") is None:
                logger.warning("spark.convert_idea agent recommendation truncated at max_tokens=1200; retrying with larger budget")
                retry_data = await _call_anthropic(api_key, [{"role": "user", "content": agent_user}], agent_system, max_tokens=2200)
                agent_raw = "".join(block.get("text", "") for block in retry_data.get("content", []) if block.get("type") == "text")
                extracted_agent = _extract_json_object(agent_raw)

            candidate = json.loads(extracted_agent)
            agent_rec = _normalize_agent_recommendation(candidate, request, safe_fields)
        except Exception as exc:
            logger.warning("spark.convert_idea agent recommendation fallback: %s", exc)

    if agent_rec is None:
        agent_rec = _fallback_agent_recommendation(request, safe_fields)

    return SparkConvertResponse(use_case_fields=safe_fields, agent_recommendation=agent_rec)
