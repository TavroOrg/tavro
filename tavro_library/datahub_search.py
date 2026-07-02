import threading
from typing import Any, Dict, List, Optional

from fastembed import TextEmbedding

from utils.db import SyncSessionLocal

# Must match the model used in datahub/ingest_datahub_vectors.py — embeddings
# from a different model are not comparable in the same vector space.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_model: Optional[TextEmbedding] = None
_model_lock = threading.Lock()


def _get_model() -> TextEmbedding:
    """Lazily load the ONNX embedder once per process (first call pays the load cost)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _model


def _to_pgvector_literal(values: List[float]) -> str:
    return "[" + ",".join(repr(v) for v in values) + "]"


def search_datahub_context(
    query: Optional[str] = None,
    company_id: Optional[str] = None,
    schema: Optional[str] = None,
    vendor: Optional[str] = None,
    application: Optional[str] = None,
    industry: Optional[str] = None,
    entity_type: Optional[str] = None,
    tags: Optional[List[str]] = None,
    limit: int = 5,
    count_only: bool = False,
) -> Dict[str, Any]:
    """
    Retrieve DataHub metadata rows from twin.datahub_context.

    Two retrieval modes, combinable:
      - `query` (semantic): embeds the text with the same model used at
        ingestion and ranks by cosine similarity. Good for fuzzy/topical
        questions ("columns that look sensitive"). NOT exhaustive — only
        returns the top `limit` matches, so it is the wrong tool for
        "how many" / "list all" questions.
      - Exact filters (`schema`, `vendor`, `application`, `industry`,
        `entity_type`, `tags`): precise metadata equality matches. Use these
        (with `count_only=True` for pure counts) for "how many tables are in
        schema X" style questions, since they scan the exact filter rather
        than approximating it with nearest-neighbor search.

    If neither `query` nor any filter is given, only the company/global scope
    condition applies (i.e. returns everything in scope, capped by `limit`).

    Global/template rows (company_id IS NULL) are always eligible; rows scoped
    to `company_id` are additionally included when provided.

    Returns {"count": N} when count_only, else {"results": [...], "count": N}.
    """
    where_clauses = ["(company_id IS NULL OR company_id = %s::uuid)"]
    params: List[Any] = [company_id]

    # Case-insensitive equality — callers (LLM-formulated args) can't be
    # expected to know exact stored casing (e.g. entity_type is "DATASET").
    if schema:
        where_clauses.append("LOWER(metadata->>'schema') = LOWER(%s)")
        params.append(schema)
    if vendor:
        where_clauses.append("LOWER(metadata->>'vendor') = LOWER(%s)")
        params.append(vendor)
    if application:
        where_clauses.append("LOWER(metadata->>'application') = LOWER(%s)")
        params.append(application)
    if industry:
        where_clauses.append("LOWER(metadata->>'industry') = LOWER(%s)")
        params.append(industry)
    if entity_type:
        where_clauses.append("LOWER(entity_type) = LOWER(%s)")
        params.append(entity_type)
    if tags:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(metadata->'tags') t "
            "WHERE LOWER(t) = ANY(%s::text[]))"
        )
        params.append([t.lower() for t in tags])

    where_sql = " AND ".join(where_clauses)
    has_query = bool(query and query.strip())

    session = SyncSessionLocal()
    try:
        conn = session.connection()
        cursor = conn.connection.cursor()
        try:
            if count_only:
                cursor.execute(
                    f"SELECT COUNT(*) FROM twin.datahub_context WHERE {where_sql}",
                    params,
                )
                count = cursor.fetchone()[0]
                conn.connection.commit()
                return {"count": count}

            if has_query:
                embedding = next(_get_model().embed([query])).tolist()
                vector_literal = _to_pgvector_literal(embedding)
                capped_limit = max(1, min(int(limit or 5), 20))
                cursor.execute(
                    f"""
                    SELECT urn, entity_type, label, chunk_text, metadata,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM twin.datahub_context
                    WHERE {where_sql}
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    [vector_literal, *params, vector_literal, capped_limit],
                )
            else:
                # Exact-filter browse — no query text to rank by, so list
                # matches directly (no similarity score).
                capped_limit = max(1, min(int(limit or 50), 100))
                cursor.execute(
                    f"""
                    SELECT urn, entity_type, label, chunk_text, metadata,
                           NULL AS similarity
                    FROM twin.datahub_context
                    WHERE {where_sql}
                    ORDER BY label
                    LIMIT %s
                    """,
                    [*params, capped_limit],
                )

            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            conn.connection.commit()
            return {"results": rows, "count": len(rows)}
        finally:
            cursor.close()
    finally:
        session.close()
