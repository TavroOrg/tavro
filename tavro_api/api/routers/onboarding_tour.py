from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

_ENSURE_TABLE = """
CREATE TABLE IF NOT EXISTS twin.user_tour_status (
    user_id    TEXT        NOT NULL PRIMARY KEY,
    status     TEXT        NOT NULL DEFAULT 'not_started',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def _extract_user_id(request: Request) -> str:
    """Derive a stable user identifier from the JWT sub or x-tenant-id header."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        try:
            parts = token.split(".")
            if len(parts) >= 2:
                padding = 4 - len(parts[1]) % 4
                payload = json.loads(
                    base64.urlsafe_b64decode(parts[1] + "=" * padding)
                )
                sub = payload.get("sub")
                if sub:
                    return str(sub)
        except Exception:
            pass
    tenant = request.headers.get("x-tenant-id", "").strip()
    return tenant or "anonymous"


class TourStatusUpdate(BaseModel):
    status: str  # "completed" | "skipped"


@router.get("/status")
async def get_tour_status(request: Request, db: AsyncSession = Depends(get_db)):
    await db.execute(text(_ENSURE_TABLE))
    await db.commit()

    user_id = _extract_user_id(request)
    result = await db.execute(
        text("SELECT status FROM twin.user_tour_status WHERE user_id = :uid"),
        {"uid": user_id},
    )
    row = result.fetchone()
    if not row:
        return {"showTour": True, "status": "not_started"}
    status = row[0]
    return {"showTour": status == "not_started", "status": status}


@router.post("/status")
async def update_tour_status(
    request: Request, body: TourStatusUpdate, db: AsyncSession = Depends(get_db)
):
    if body.status not in ("completed", "skipped"):
        raise HTTPException(status_code=422, detail="status must be 'completed' or 'skipped'")

    await db.execute(text(_ENSURE_TABLE))

    user_id = _extract_user_id(request)
    await db.execute(
        text("""
            INSERT INTO twin.user_tour_status (user_id, status, updated_at)
            VALUES (:uid, :status, NOW())
            ON CONFLICT (user_id) DO UPDATE
                SET status = EXCLUDED.status, updated_at = NOW()
        """),
        {"uid": user_id, "status": body.status},
    )
    await db.commit()
    return {"ok": True}
