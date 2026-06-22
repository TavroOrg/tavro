"""
Company listing endpoint for the Admin Portal.
Reads from twin.company — same table the main portal uses.
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from api.database import AsyncSessionLocal

router = APIRouter()


@router.get("/companies")
async def list_companies():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT id, name, industry, region, legal_entity FROM twin.company ORDER BY name")
        )
        rows = result.fetchall()
    return [
        {
            "id":           str(r.id),
            "name":         r.name,
            "industry":     r.industry,
            "region":       r.region,
            "legal_entity": r.legal_entity,
        }
        for r in rows
    ]
