from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_INSERT_SQL = text(
    "INSERT INTO twin.enterprise_metadata "
    "(id, tenant_id, company_id, file_name, row_index, chunk_text, row_data, embedding) "
    "VALUES (:id, :tenant_id, :company_id, :file_name, :row_index, :chunk_text, "
    "CAST(:row_data AS JSONB), CAST(:embedding AS VECTOR))"
)


def to_pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


async def is_file_already_processed(
    db: AsyncSession, tenant_id: str, company_id: str | None, file_name: str
) -> bool:
    result = await db.execute(
        text(
            "SELECT 1 FROM twin.enterprise_metadata WHERE tenant_id = :tid "
            "AND company_id IS NOT DISTINCT FROM :cid AND file_name = :file_name LIMIT 1"
        ),
        {"tid": tenant_id, "cid": company_id, "file_name": file_name},
    )
    return result.first() is not None


async def insert_chunks(
    db: AsyncSession,
    tenant_id: str,
    company_id: str | None,
    file_name: str,
    chunks: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> None:
    for chunk, vector in zip(chunks, embeddings):
        await db.execute(_INSERT_SQL, {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "company_id": company_id,
            "file_name": file_name,
            "row_index": chunk["row_index"],
            "chunk_text": chunk["chunk_text"],
            "row_data": json.dumps(chunk["row_data"]),
            "embedding": to_pgvector_literal(vector),
        })
    await db.commit()
