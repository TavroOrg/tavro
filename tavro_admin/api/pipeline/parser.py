from __future__ import annotations

import io

import pandas as pd


def parse_csv(raw: bytes) -> pd.DataFrame:
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError(f"Could not parse this file as CSV: {exc}") from exc

    if df.empty:
        raise ValueError("The CSV file has no data rows.")

    return df
