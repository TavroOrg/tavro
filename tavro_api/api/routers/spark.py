from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncGenerator, Literal

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db, AsyncSessionLocal

router = APIRouter()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"
SPARK_MAX_TOKENS  = 2000
SPARK_DEFAULT_IDEAS     = 5
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
    user_reaction: Literal["like", "dislike"] | None = None
    popularity_score: int = 0


class SparkReactionRequest(BaseModel):
    reaction: Literal["like", "dislike"] | None = None


class SparkReactionResponse(BaseModel):
    idea_id: str
    user_reaction: Literal["like", "dislike"] | None = None
    popularity_score: int


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
    blueprint_dimensions: list[dict[str, Any]] | None = None
    blueprint_edges: list[dict[str, Any]] | None = None


class SparkConvertResponse(BaseModel):
    use_case_fields: dict
    agent_recommendation: dict | None = None


class SparkContextResponse(BaseModel):
    mode: str
    candidates: list[dict] = []
    company_nodes: list[dict] = []
    edges: list[dict] = []
    similar_agents: list[dict] = []


class SparkIdeaBatchRequest(BaseModel):
    company_id: str
    ideas: list[SparkIdea]
    clear_existing: bool = False


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


# ── Gap analysis queries / data helpers ───────────────────────────────────────

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


_VALID_IO_MODES = {
    "text", "structured_data", "api_response", "database_query",
    "file", "alert", "report", "event", "stream",
}

def _sanitize_skills(raw_skills: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_skills, list):
        return []

    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_skills:
        if not isinstance(item, dict):
            continue
        name = _to_text(item.get("name"))
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())

        def _clean_modes(raw: Any) -> list[str]:
            if isinstance(raw, str):
                raw = [raw]
            if not isinstance(raw, list):
                return []
            return [m for m in (_to_text(v).lower() for v in raw) if m in _VALID_IO_MODES]

        input_modes = _clean_modes(item.get("input_modes") or item.get("inputModes"))
        output_modes = _clean_modes(item.get("output_modes") or item.get("outputModes"))

        raw_tags = item.get("tags")
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        tags = [_to_text(t) for t in (raw_tags or []) if _to_text(t)][:6]

        cleaned.append({
            "name": name,
            "description": _to_text(item.get("description"), f"Skill: {name}"),
            "tags": tags,
            "input_modes": input_modes or ["text"],
            "output_modes": output_modes or ["structured_data"],
        })
    return cleaned[:6]


def _sanitize_column_names(raw_columns: Any) -> list[str]:
    if isinstance(raw_columns, (str, dict)):
        raw_columns = [raw_columns]
    if not isinstance(raw_columns, list):
        return []

    names: list[str] = []
    seen: set[str] = set()
    for raw in raw_columns:
        if isinstance(raw, dict):
            name = _to_text(raw.get("name") or raw.get("column_name") or raw.get("identifier"))
        else:
            name = _to_text(raw)
        key = name.lower()
        if name and key not in seen:
            names.append(name)
            seen.add(key)
    return names


def _sanitize_tables(raw_tables: Any) -> list[dict[str, Any]]:
    if isinstance(raw_tables, (str, dict)):
        raw_tables = [raw_tables]
    if not isinstance(raw_tables, list):
        return []

    tables: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_tables:
        if isinstance(raw, str):
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        name = _to_text(raw.get("name") or raw.get("table_name"))
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)

        table: dict[str, Any] = {
            "name": name,
            "description": _to_text(raw.get("description"), f"Operational data table for {name}"),
            "columns": _sanitize_column_names(raw.get("columns") or raw.get("column")),
        }
        tool_name = _to_text(raw.get("tool_name") or raw.get("tool"))
        if tool_name:
            table["tool_name"] = tool_name
        tables.append(table)
    return tables[:4]


def _sanitize_columns(raw_columns: Any, tables: list[dict[str, Any]]) -> list[dict[str, str]]:
    if isinstance(raw_columns, (str, dict)):
        raw_columns = [raw_columns]
    if not isinstance(raw_columns, list):
        raw_columns = []

    columns: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    fallback_table = tables[0]["name"] if len(tables) == 1 else ""

    def add_column(name: str, table_name: str = "") -> None:
        table = table_name or fallback_table
        key = (name.lower(), table.lower())
        if name and key not in seen:
            item = {"name": name}
            if table:
                item["table_name"] = table
            columns.append(item)
            seen.add(key)

    for raw in raw_columns:
        if isinstance(raw, str):
            add_column(_to_text(raw))
            continue
        if not isinstance(raw, dict):
            continue
        name = _to_text(raw.get("name") or raw.get("column_name") or raw.get("identifier"))
        table_name = _to_text(raw.get("table_name") or raw.get("table"))
        add_column(name, table_name)

    for table in tables:
        table_name = _to_text(table.get("name"))
        for column_name in table.get("columns") or []:
            add_column(_to_text(column_name), table_name)

    return columns[:24]


def _fallback_lineage(request: SparkConvertRequest, fields: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    use_case_title = _to_text(fields.get("title"), request.title)
    context_label = _to_text(request.signal_label, use_case_title)
    base_name = re.sub(r"[^A-Za-z0-9]+", " ", context_label).strip() or use_case_title
    words = re.findall(r"[A-Za-z0-9]+", base_name)[:4] or ["Operational"]
    table_name = " ".join(words + ["Signals"])
    columns = [
        "record_id",
        "event_timestamp",
        "source_system",
        "status",
        "priority_score",
        "recommended_action",
    ]
    tables = [{
        "name": table_name,
        "description": f"Source records and signals used by the {use_case_title} agent.",
        "columns": columns,
    }]
    return tables, [{"name": name, "table_name": table_name} for name in columns]


def _fallback_agent_recommendation(request: SparkConvertRequest, fields: dict[str, Any]) -> dict[str, Any]:
    use_case_title = _to_text(fields.get("title"), request.title)
    use_case_desc = _to_text(fields.get("description"), request.description)
    dimensions = [d for d in request.target_dimensions if _to_text(d)]
    dim_text = ", ".join(dimensions) if dimensions else "process"
    context_label = _to_text(request.signal_label, dim_text)
    tables, columns = _fallback_lineage(request, fields)

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
        "tables": tables,
        "columns": columns,
        "skills": [
            {
                "name": "Signal Monitoring",
                "description": f"Continuously monitors {context_label.lower()} signals and triggers on threshold breaches.",
                "tags": ["monitoring", "alerting", dim_text],
                "input_modes": ["structured_data", "database_query"],
                "output_modes": ["alert", "structured_data"],
            },
            {
                "name": "Recommendation Generation",
                "description": f"Produces prioritized, rationale-backed action recommendations for {use_case_title}.",
                "tags": ["recommendation", "reasoning", dim_text],
                "input_modes": ["structured_data"],
                "output_modes": ["report", "structured_data"],
            },
            {
                "name": "Outcome Tracking",
                "description": "Persists decision traces and incorporates human feedback for governance and model improvement.",
                "tags": ["governance", "feedback", "audit"],
                "input_modes": ["text", "structured_data"],
                "output_modes": ["structured_data"],
            },
        ],
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

    tables = _sanitize_tables(candidate.get("tables") or candidate.get("table"))
    if tables:
        result["tables"] = tables

    columns = _sanitize_columns(candidate.get("columns") or candidate.get("column"), result.get("tables") or [])
    if columns:
        result["columns"] = columns

    skills = _sanitize_skills(candidate.get("skills"))
    if skills:
        result["skills"] = skills

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


async def _fetch_all_company_nodes(db: AsyncSession, company_id: str, limit: int = 40) -> list[dict]:
    try:
        async with db.begin_nested():
            rows = await db.execute(text("""
                SELECT dn.id, dn.label, dn.summary, dt.category
                FROM twin.dim_node dn
                JOIN twin.dim_type dt ON dn.dim_type_id = dt.id
                WHERE dn.company_id = :company_id
                ORDER BY dt.category, dn.label
                LIMIT :limit
            """), {"company_id": company_id, "limit": limit})
            return [
                {
                    "node_id": str(row["id"]),
                    "label": row["label"] or "Unnamed",
                    "category": row["category"],
                    "summary": (row["summary"] or "")[:200],
                }
                for row in rows.mappings()
            ]
    except Exception:
        return []


async def _fetch_company_edges(db: AsyncSession, company_id: str, limit: int = 50) -> list[dict]:
    try:
        async with db.begin_nested():
            rows = await db.execute(text("""
                SELECT sn.label AS source_label, tn.label AS target_label, e.rel_type
                FROM twin.dim_edge e
                JOIN twin.dim_node sn ON sn.id = e.source_id
                JOIN twin.dim_node tn ON tn.id = e.target_id
                WHERE sn.company_id = :company_id
                ORDER BY e.rel_type, sn.label
                LIMIT :limit
            """), {"company_id": company_id, "limit": limit})
            return [
                {
                    "source_label": row["source_label"] or "",
                    "target_label": row["target_label"] or "",
                    "rel_type": row["rel_type"] or "relates_to",
                }
                for row in rows.mappings()
            ]
    except Exception:
        return []


async def _collect_candidates(db: AsyncSession, company_id: str, dim_filter: list[str], count: int = SPARK_DEFAULT_IDEAS) -> list[dict]:
    active_signals = dim_filter or ["process", "risk", "strategy", "application", "integration"]

    per_bucket = max(2, (count + 2) // 3)
    buckets: list[list[dict]] = []

    if "process" in active_signals:
        b = await _fetch_dim_node_candidates(db, company_id, ["process"], "gap_coverage", "Process with no AI coverage", limit=per_bucket)
        if b:
            buckets.append(b)

    if "risk" in active_signals:
        b = await _fetch_dim_node_candidates(db, company_id, ["risk"], "risk_hotspot", "Risk area with no monitoring agent", limit=per_bucket)
        if b:
            buckets.append(b)

    if "strategy" in active_signals or "finance" in active_signals:
        strat_cats = [c for c in ["strategy", "finance"] if c in active_signals or not dim_filter]
        if strat_cats:
            b = await _fetch_dim_node_candidates(db, company_id, strat_cats, "strategic_gap", "Strategic or financial area with AI potential", limit=per_bucket)
            if b:
                buckets.append(b)

    if "application" in active_signals:
        b = await _fetch_dim_node_candidates(db, company_id, ["application"], "integration_surface", "Application with no AI agent integration", limit=per_bucket)
        if b:
            buckets.append(b)

    if "integration" in active_signals:
        b = await _fetch_dim_node_candidates(db, company_id, ["integration"], "integration_surface", "Integration surface with no agent coverage", limit=per_bucket)
        if b:
            buckets.append(b)

    # Round-robin interleave across buckets so ideas span all dimensions
    seen: set[str] = set()
    unique: list[dict] = []
    max_rounds = max((len(b) for b in buckets), default=0)
    for r in range(max_rounds):
        for bucket in buckets:
            if r < len(bucket):
                node = bucket[r]
                if node["node_id"] not in seen:
                    seen.add(node["node_id"])
                    unique.append(node)

    return unique[:count]


async def _upsert_ideas(company_id: str, ideas: list[SparkIdea]) -> None:
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
               target_dimensions, target_nodes, complexity, estimated_impact, similar_agents,
               user_reaction, popularity_score
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
            user_reaction=r["user_reaction"],
            popularity_score=r["popularity_score"] or 0,
        ))
    return result


@router.patch("/ideas/{idea_id}/reaction", response_model=SparkReactionResponse)
async def update_spark_idea_reaction(
    idea_id: str,
    payload: SparkReactionRequest,
    company_id: str = Query(..., description="Company UUID"),
    db: AsyncSession = Depends(get_db),
) -> SparkReactionResponse:
    """Persist the current user's Spark idea reaction and derived popularity score."""
    current = await db.execute(text("""
        SELECT user_reaction, popularity_score
        FROM core.spark_ideas
        WHERE company_id = :company_id AND idea_id = :idea_id
    """), {"company_id": company_id, "idea_id": idea_id})
    row = current.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Spark idea not found")

    previous_reaction = row["user_reaction"]
    previous_value = 1 if previous_reaction == "like" else -1 if previous_reaction == "dislike" else 0
    next_value = 1 if payload.reaction == "like" else -1 if payload.reaction == "dislike" else 0
    popularity_score = int(row["popularity_score"] or 0) - previous_value + next_value

    await db.execute(text("""
        UPDATE core.spark_ideas
        SET user_reaction = :reaction,
            popularity_score = :popularity_score,
            updated_at = NOW()
        WHERE company_id = :company_id AND idea_id = :idea_id
    """), {
        "company_id": company_id,
        "idea_id": idea_id,
        "reaction": payload.reaction,
        "popularity_score": popularity_score,
    })
    await db.commit()

    return SparkReactionResponse(
        idea_id=idea_id,
        user_reaction=payload.reaction,
        popularity_score=popularity_score,
    )


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


@router.get("/context", response_model=SparkContextResponse)
async def get_spark_context(
    company_id: str = Query(..., description="Company UUID"),
    dimensions: str | None = Query(None, description="Comma-separated dimension filter"),
    direction: str | None = Query(None, description="User-specified focus area"),
    idea_count: int = Query(SPARK_DEFAULT_IDEAS, ge=1, le=SPARK_MAX_IDEAS),
    db: AsyncSession = Depends(get_db),
) -> SparkContextResponse:
    """Return DB context (candidates or company nodes) for the copilot server to generate ideas."""
    dim_filter = [d.strip() for d in dimensions.split(",")] if dimensions else []
    direction_clean = direction.strip() if direction and direction.strip() else None

    edges = await _fetch_company_edges(db, company_id)
    similar_agents = await _fetch_agents(db)
    edge_dicts = [{"source_label": e["source_label"], "target_label": e["target_label"], "rel_type": e["rel_type"]} for e in edges]
    agent_dicts = [{"agent_id": a.agent_id, "agent_name": a.agent_name} for a in similar_agents]

    if direction_clean:
        company_nodes = await _fetch_all_company_nodes(db, company_id)
        return SparkContextResponse(
            mode="direction",
            company_nodes=company_nodes,
            edges=edge_dicts,
            similar_agents=agent_dicts,
        )
    else:
        candidates = await _collect_candidates(db, company_id, dim_filter, idea_count)
        return SparkContextResponse(
            mode="gap",
            candidates=candidates,
            edges=edge_dicts,
            similar_agents=agent_dicts,
        )


@router.post("/ideas/batch", status_code=204)
async def save_spark_ideas_batch(request: SparkIdeaBatchRequest) -> None:
    """Persist a batch of ideas generated by the copilot server."""
    if not request.ideas:
        return
    if request.clear_existing:
        async with AsyncSessionLocal() as clear_db:
            await clear_db.execute(
                text("DELETE FROM core.spark_ideas WHERE company_id = :company_id"),
                {"company_id": request.company_id},
            )
            await clear_db.commit()
    await _upsert_ideas(request.company_id, request.ideas)


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

    blueprint_block = ""
    if request.blueprint_dimensions:
        dim_lines = "\n".join(
            "  [{}] {}{}".format(
                d.get("category", "custom"),
                d.get("label", ""),
                " — " + d["summary"][:100] if d.get("summary") else "",
            )
            for d in request.blueprint_dimensions[:30]
        )
        blueprint_block = f"\nCompany Blueprint Dimensions:\n{dim_lines}"
        if request.blueprint_edges:
            edge_lines = "\n".join(
                "  {} —[{}]→ {}".format(
                    e.get("sourceLabel", ""), e.get("relType", ""), e.get("targetLabel", "")
                )
                for e in request.blueprint_edges[:20]
            )
            blueprint_block += f"\n\nDimension Relationships:\n{edge_lines}"
        blueprint_block += "\n\n"

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
        f"Dimensions: {', '.join(request.target_dimensions)}\n"
        f"{blueprint_block}"
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

    cleaned_fields = {k: _to_str(v) for k, v in fields.items()}
    cleaned_fields.setdefault("title", request.title)
    cleaned_fields.setdefault("description", request.description)
    cleaned_fields.setdefault("business_problem_statement", request.rationale)
    cleaned_fields.setdefault("expected_benefits", "")
    cleaned_fields.setdefault("solution_approach", "")
    cleaned_fields.setdefault("priority", priority)

    system2 = (
        "You are an expert AI agent architect. Given a specific AI use case, define the best autonomous agent to implement it. "
        "Be specific, practical, and grounded in real technical capabilities. No filler phrases."
    )
    user2 = (
        f"Design an autonomous AI agent for this use case:\n\n"
        f"Title: {cleaned_fields['title']}\n"
        f"Description: {cleaned_fields['description']}\n"
        f"Business problem: {cleaned_fields.get('business_problem_statement', '')}\n"
        f"Solution approach: {cleaned_fields.get('solution_approach', '')}\n\n"
        "Return a single JSON object with these fields:\n"
        "- agent_name: concise operational name ending in 'Agent' (max 5 words)\n"
        "- description: 2 sentences — what the agent does and what outcome it produces\n"
        "- instruction: 3-4 sentences of specific operating instructions — what to monitor, how to analyse, when to act, how to report\n"
        "- tools: array of {name, description} — 2–4 specific tools this agent needs\n"
        "- knowledge_source: {name, description} — primary data or knowledge source\n"
        "- tables: array of {name, description, columns: [string]} — 1–3 data tables the agent reads or writes\n"
        "- columns: array of {name, table_name} — key columns across those tables\n"
        "- skills: array of {name, description, tags: [string], input_modes: [string], output_modes: [string]} — 2–4 agent skills\n\n"
        "Return ONLY the JSON object. No prose, no markdown fencing."
    )

    try:
        data2 = await _call_anthropic(api_key, [{"role": "user", "content": user2}], system2, max_tokens=1500)
        raw2 = "".join(
            block.get("text", "") for block in data2.get("content", []) if block.get("type") == "text"
        )
        agent_raw = json.loads(_extract_json_object(raw2))
    except Exception as exc:
        logger.warning("spark.convert_idea agent-recommendation fallback: %s", exc)
        agent_raw = None

    return SparkConvertResponse(
        use_case_fields=cleaned_fields,
        agent_recommendation=_normalize_agent_recommendation(agent_raw, request, cleaned_fields),
    )
