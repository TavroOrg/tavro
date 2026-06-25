"""
Company listing endpoint for the Admin Portal.
Reads from twin.company — same table the main portal uses.
Admin view shows all companies across all tenants (with tenant_id for visibility).
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import text

from api.database import AsyncSessionLocal

router = APIRouter()


@router.get("/companies")
async def list_companies(tenant_id: str | None = Query(None)):
    async with AsyncSessionLocal() as db:
        if tenant_id:
            result = await db.execute(
                text(
                    "SELECT id, name, industry, region, legal_entity, tenant_id "
                    "FROM twin.company WHERE tenant_id = :tid ORDER BY name"
                ),
                {"tid": tenant_id},
            )
        else:
            result = await db.execute(
                text(
                    "SELECT id, name, industry, region, legal_entity, tenant_id "
                    "FROM twin.company ORDER BY tenant_id NULLS LAST, name"
                )
            )
        rows = result.fetchall()
    return [
        {
            "id":           str(r.id),
            "name":         r.name,
            "industry":     r.industry,
            "region":       r.region,
            "legal_entity": r.legal_entity,
            "tenant_id":    r.tenant_id,
        }
        for r in rows
    ]
