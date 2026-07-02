#!/usr/bin/env python3
"""
Embeds a DataHub metadata export (see datahub/datahub.json) into
twin.datahub_context so it becomes searchable via pgvector. This context is
global (company_id is NULL) — it is not filtered or scoped per company.

Uses a local ONNX embedder (fastembed, all-MiniLM-L6-v2, 384 dims) — no
external API key required.

Self-contained: creates its own schema (sql/twin_datahub_context.sql) if it
doesn't exist yet, and skips re-embedding if global rows already exist —
safe to run unattended on every container start.

Usage:
    pip install -r requirements.txt
    DATABASE_URL=postgresql://user:pass@localhost:5432/tavro \
    python datahub/ingest_datahub_vectors.py [--file datahub/datahub.json] [--force]
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

from fastembed import TextEmbedding

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_dotenv_if_present() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv_if_present()

from utils.db import db_connection

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_BATCH_SIZE = 50
SCHEMA_SQL_PATH = REPO_ROOT / "sql" / "twin_datahub_context.sql"


def build_chunk_text(entry: Dict[str, Any]) -> str:
    columns = entry.get("columns") or []
    column_list = ", ".join(
        f"{c.get('name')} ({c.get('native_data_type')})" for c in columns if c.get("name")
    )
    table_tags = entry.get("tags") or []
    tag_list = ", ".join(str(tag) for tag in table_tags if tag)
    sensitive_columns = [
        c.get("name")
        for c in columns
        if c.get("name") and (c.get("sensitive") or "sensitive" in [str(t).lower() for t in (c.get("tags") or [])])
    ]
    sensitive_column_list = ", ".join(sensitive_columns)
    tagged_columns = []
    for column in columns:
        column_tags = [str(tag) for tag in (column.get("tags") or []) if tag]
        if column.get("name") and column_tags:
            tagged_columns.append(f"{column.get('name')}: {', '.join(column_tags)}")
    parts = [
        f"{entry.get('name')} ({entry.get('type')})",
        entry.get("description") or "",
        f"Industry: {entry.get('industry')} | Vendor: {entry.get('vendor')} | "
        f"Application: {entry.get('application')} | Coverage Area: {entry.get('coverage_area')} | "
        f"Schema: {entry.get('schema')} | Category: {entry.get('category')}",
    ]
    if tag_list:
        parts.append(f"Table Tags: {tag_list}")
    if column_list:
        parts.append(f"Columns: {column_list}")
    if sensitive_column_list:
        parts.append(f"Sensitive Columns: {sensitive_column_list}")
    if tagged_columns:
        parts.append(f"Column Tags: {'; '.join(tagged_columns)}")
    return "\n".join(p for p in parts if p)


def embed_texts(model: TextEmbedding, texts: List[str]) -> List[List[float]]:
    return [vector.tolist() for vector in model.embed(texts, batch_size=EMBEDDING_BATCH_SIZE)]


def to_pgvector_literal(values: List[float]) -> str:
    return "[" + ",".join(repr(v) for v in values) + "]"


def upsert_dataset(
    cur,
    scope: str,
    entry: Dict[str, Any],
    chunk_text: str,
    embedding: List[float],
) -> None:
    urn = entry["urn"]
    label = entry.get("name") or urn
    metadata = json.dumps(
        {
            "industry": entry.get("industry"),
            "vendor": entry.get("vendor"),
            "application": entry.get("application"),
            "coverage_area": entry.get("coverage_area"),
            "schema": entry.get("schema"),
            "category": entry.get("category"),
            "tags": entry.get("tags") or [],
            "sensitive_columns": [
                c.get("name")
                for c in (entry.get("columns") or [])
                if c.get("name") and (c.get("sensitive") or "sensitive" in [str(t).lower() for t in (c.get("tags") or [])])
            ],
            "column_names": [
                c.get("name")
                for c in (entry.get("columns") or [])
                if c.get("name")
            ],
            "columns": entry.get("columns") or [],
            "column_count": len(entry.get("columns") or []),
        }
    )
    vector_literal = to_pgvector_literal(embedding)

    cur.execute(
        """
        INSERT INTO twin.datahub_context
            (company_id, scope, urn, entity_type, label, chunk_text, metadata, embedding)
        VALUES
            (NULL, %s, %s, %s, %s, %s, %s::jsonb, %s::vector)
        ON CONFLICT (scope, company_id, urn) DO UPDATE SET
            entity_type = EXCLUDED.entity_type,
            label       = EXCLUDED.label,
            chunk_text  = EXCLUDED.chunk_text,
            metadata    = EXCLUDED.metadata,
            embedding   = EXCLUDED.embedding
        """,
        (scope, urn, entry.get("type"), label, chunk_text, metadata, vector_literal),
    )


def ensure_schema(cur) -> None:
    """Idempotently applies sql/twin_datahub_context.sql. Docker's
    docker-entrypoint-initdb.d only runs on a fresh, empty data volume, so an
    already-running production DB would never pick this table up otherwise."""
    cur.execute(SCHEMA_SQL_PATH.read_text(encoding="utf-8"))


def has_existing_rows(cur, scope: str) -> bool:
    cur.execute(
        "SELECT 1 FROM twin.datahub_context WHERE company_id IS NULL AND scope = %s LIMIT 1",
        (scope,),
    )
    return cur.fetchone() is not None


def ingest(file_path: Path, scope: str, force: bool) -> None:
    with db_connection() as conn:
        with conn.cursor() as cur:
            ensure_schema(cur)

            if not force and has_existing_rows(cur, scope):
                print(f"twin.datahub_context already has global rows for scope={scope} — skipping.")
                return

            with file_path.open(encoding="utf-8") as f:
                data = json.load(f)
            entries: List[Dict[str, Any]] = data.get("results") or []
            if not entries:
                print(f"No results found in {file_path}")
                return

            model = TextEmbedding(model_name=EMBEDDING_MODEL)
            print(f"Embedding {len(entries)} datasets with {EMBEDDING_MODEL}...")
            chunk_texts = [build_chunk_text(e) for e in entries]
            embeddings = embed_texts(model, chunk_texts)

            for entry, chunk_text, embedding in zip(entries, chunk_texts, embeddings):
                upsert_dataset(cur, scope, entry, chunk_text, embedding)

    print(f"Ingested {len(entries)} datasets into twin.datahub_context (global, scope={scope})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=str(Path(__file__).parent / "datahub.json"))
    parser.add_argument("--scope", default="global_template", help="Context scope, defaults to global_template")
    parser.add_argument("--force", action="store_true", help="Re-embed even if global rows already exist for this scope")
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"ERROR: file not found: {file_path}")
        sys.exit(1)

    ingest(file_path, args.scope, args.force)


if __name__ == "__main__":
    main()
