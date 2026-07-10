from __future__ import annotations

from typing import Any

import pandas as pd


def build_chunks(df: pd.DataFrame) -> list[dict[str, Any]]:
    """One chunk per non-empty CSV row: chunk_text is every populated
    column rendered as "column: value" lines, schema-agnostic by design."""
    chunks: list[dict[str, Any]] = []

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

        chunks.append({
            "row_index": int(row_index),
            "chunk_text": "\n".join(lines),
            "row_data": row_data,
        })

    return chunks
