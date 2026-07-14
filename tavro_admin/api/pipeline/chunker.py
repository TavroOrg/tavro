from __future__ import annotations

import re
from typing import Any

import pandas as pd

# Optional typed-metadata columns: mapped onto twin.enterprise_metadata's
# dedicated columns when the CSV has a matching header (case-insensitive);
# left empty otherwise.
KNOWN_COLUMNS = ("metadata_type", "source_system", "namespace", "label", "description", "tags", "is_sensitive")

_TRUE_VALUES = {"true", "1", "yes", "y"}


def _match_known_columns(df: pd.DataFrame) -> dict[str, str]:
    normalized = {str(column).strip().lower(): column for column in df.columns}
    return {field: normalized[field] for field in KNOWN_COLUMNS if field in normalized}


def _coerce_known_value(field: str, text_value: str) -> Any:
    if field == "tags":
        return [tag.strip() for tag in re.split(r"[;,]", text_value) if tag.strip()]
    if field == "is_sensitive":
        return text_value.strip().lower() in _TRUE_VALUES
    return text_value


def build_chunks(df: pd.DataFrame) -> list[dict[str, Any]]:
    """One chunk per non-empty CSV row: chunk_text is every populated
    column rendered as "column: value" lines, schema-agnostic by design."""
    chunks: list[dict[str, Any]] = []
    known_column_map = _match_known_columns(df)

    for row_index, row in df.iterrows():
        lines: list[str] = []
        row_data: dict[str, str] = {}

        for column, value in row.items():
            if pd.isna(value):
                continue
            text_value = str(value).strip()
            if not text_value:
                continue
            lines.append(f"{column}: {text_value}")
            row_data[str(column)] = text_value

        if not lines:
            continue

        known_columns: dict[str, Any] = {}
        for field, column in known_column_map.items():
            value = row[column]
            if pd.isna(value):
                continue
            text_value = str(value).strip()
            if not text_value:
                continue
            known_columns[field] = _coerce_known_value(field, text_value)

        chunks.append({
            "row_index": int(row_index),
            "chunk_text": "\n".join(lines),
            "row_data": row_data,
            "known_columns": known_columns,
        })

    return chunks
