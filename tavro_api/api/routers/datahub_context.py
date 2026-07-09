# =============================================================
# api/routers/datahub_context.py
# Direct semantic (RAG) search over twin.datahub_context (pgvector DataHub
# metadata). Called straight from the frontend for every chat turn — NOT
# exposed as an LLM-callable tool — so the assistant always has DataHub
# grounding scoped to that turn's query, never the full catalog and never
# gated behind a model deciding whether to call a tool.
# =============================================================

import asyncio
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastembed import TextEmbedding
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

# Must match the model used in datahub/ingest_datahub_vectors.py — embeddings
# from a different model are not comparable in the same vector space.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# Below this cosine similarity, a match is noise rather than grounding —
# drop it so unrelated chat turns (greetings, risk questions, etc.) don't
# get a DataHub block injected at all.
MIN_RELEVANCE = 0.3

_embedder: Optional[TextEmbedding] = None
_embedder_lock = asyncio.Lock()


async def _get_embedder() -> TextEmbedding:
    """Lazily load the ONNX embedder off the event loop, once per process."""
    global _embedder
    if _embedder is None:
        async with _embedder_lock:
            if _embedder is None:
                loop = asyncio.get_event_loop()
                _embedder = await loop.run_in_executor(
                    None, lambda: TextEmbedding(model_name=EMBEDDING_MODEL)
                )
    return _embedder


async def _embed_query(query: str) -> List[float]:
    embedder = await _get_embedder()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, lambda: next(embedder.embed([query])).tolist()
    )


@router.get("/search")
async def search_datahub_context(
    query: str = Query(..., min_length=1, description="Natural-language search query"),
    company_id: Optional[UUID] = Query(None),
    limit: int = Query(8, ge=1, le=100),
    schema: Optional[str] = Query(None, description="Exact schema metadata filter"),
    vendor: Optional[str] = Query(None, description="Exact/contains vendor metadata filter"),
    application: Optional[str] = Query(None, description="Exact/contains application metadata filter"),
    entity_type: Optional[str] = Query(None, description="Exact entity type filter"),
    count_only: bool = Query(False, description="Return an exact count for metadata filters"),
    db: AsyncSession = Depends(get_db),
):
    """
    Embeds `query` and returns the DataHub assets (tables/datasets) most
    relevant to it, ranked by cosine similarity and filtered to MIN_RELEVANCE.
    Scoped to global/template rows plus the given company's own rows when
    company_id is provided.
    """
    where = "company_id IS NULL"
    params: dict = {"limit": limit}
    if company_id:
        where = "(company_id IS NULL OR company_id = :company_id)"
        params["company_id"] = str(company_id)

    exact_filters = []
    if schema:
        exact_filters.append("lower(metadata->>'schema') = lower(:schema)")
        params["schema"] = schema.strip()
    if vendor:
        exact_filters.append("metadata->>'vendor' ILIKE :vendor")
        params["vendor"] = f"%{vendor.strip()}%"
    if application:
        exact_filters.append("metadata->>'application' ILIKE :application")
        params["application"] = f"%{application.strip()}%"
    if entity_type:
        exact_filters.append("lower(entity_type) = lower(:entity_type)")
        params["entity_type"] = entity_type.strip()

    if exact_filters:
        exact_where = f"{where} AND " + " AND ".join(exact_filters)
        total_rows = await db.execute(
            text(f"""
                SELECT COUNT(*) AS total
                FROM twin.datahub_context
                WHERE {exact_where}
            """),
            params,
        )
        total = int(total_rows.scalar() or 0)

        if count_only:
            return {"query": query, "mode": "exact", "count": total, "total": total, "results": []}

        rows = await db.execute(
            text(f"""
                SELECT
                    label,
                    entity_type,
                    chunk_text,
                    metadata->>'schema'       AS schema,
                    metadata->>'vendor'       AS vendor,
                    metadata->>'application'  AS application,
                    metadata->>'column_count' AS column_count,
                    NULL::double precision    AS relevance
                FROM twin.datahub_context
                WHERE {exact_where}
                ORDER BY label
                LIMIT :limit
            """),
            params,
        )
        results = [dict(r._mapping) for r in rows]
        return {"query": query, "mode": "exact", "count": len(results), "total": total, "results": results}

    vector_literal = "[" + ",".join(repr(v) for v in await _embed_query(query)) + "]"
    params["vector"] = vector_literal

    rows = await db.execute(
        text(f"""
            SELECT
                label,
                entity_type,
                chunk_text,
                metadata->>'schema'       AS schema,
                metadata->>'vendor'       AS vendor,
                metadata->>'application'  AS application,
                metadata->>'column_count' AS column_count,
                1 - (embedding <=> CAST(:vector AS vector)) AS relevance
            FROM twin.datahub_context
            WHERE {where}
            ORDER BY embedding <=> CAST(:vector AS vector)
            LIMIT :limit
        """),
        params,
    )
    results = [dict(r._mapping) for r in rows if (r._mapping["relevance"] or 0) >= MIN_RELEVANCE]

    return {"query": query, "mode": "semantic", "count": len(results), "total": len(results), "results": results}
