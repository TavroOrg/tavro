from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_INSERT_SQL = text(
    "INSERT INTO twin.enterprise_metadata "
    "(id, tenant_id, company_id, file_name, row_index, chunk_text, row_data, embedding, "
    "metadata_type, source_system, namespace, label, description, tags, is_sensitive) "
    "VALUES (:id, :tenant_id, :company_id, :file_name, :row_index, :chunk_text, "
    "CAST(:row_data AS JSONB), CAST(:embedding AS VECTOR), "
    ":metadata_type, :source_system, :namespace, :label, :description, "
    "COALESCE(CAST(:tags AS TEXT[]), ARRAY[]::TEXT[]), COALESCE(:is_sensitive, false))"
)


def to_pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


async def delete_file_chunks(
    db: AsyncSession, tenant_id: str, company_id: str | None, file_name: str
) -> None:
    await db.execute(
        text(
            "DELETE FROM twin.enterprise_metadata WHERE tenant_id = :tid "
            "AND company_id IS NOT DISTINCT FROM :cid AND file_name = :file_name"
        ),
        {"tid": tenant_id, "cid": company_id, "file_name": file_name},
    )


async def insert_chunks(
    db: AsyncSession,
    tenant_id: str,
    company_id: str | None,
    file_name: str,
    chunks: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> None:
    for chunk, vector in zip(chunks, embeddings):
        known = chunk.get("known_columns", {})
        await db.execute(_INSERT_SQL, {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "company_id": company_id,
            "file_name": file_name,
            "row_index": chunk["row_index"],
            "chunk_text": chunk["chunk_text"],
            "row_data": json.dumps(chunk["row_data"]),
            "embedding": to_pgvector_literal(vector),
            "metadata_type": known.get("metadata_type"),
            "source_system": known.get("source_system"),
            "namespace": known.get("namespace"),
            "label": known.get("label"),
            "description": known.get("description"),
            "tags": known.get("tags"),
            "is_sensitive": known.get("is_sensitive"),
        })
    await db.commit()


async def upsert_chunks(
    db: AsyncSession,
    tenant_id: str,
    company_id: str | None,
    file_name: str,
    chunks: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> None:
    """Replace any existing rows for this file, then insert the new chunks.

    Re-uploading a file can change row count/content in ways a per-row
    ON CONFLICT can't reconcile (e.g. fewer rows than before would leave
    stale trailing rows), so the whole file's prior rows are cleared first.
    """
    await delete_file_chunks(db, tenant_id, company_id, file_name)
    await insert_chunks(db, tenant_id, company_id, file_name, chunks, embeddings)
