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
        col_check = await db.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'twin' AND table_name = 'company' AND column_name = 'tenant_id'"
            )
        )
        has_tenant_id = col_check.first() is not None

        if has_tenant_id:
            select_cols = "id, name, industry, region, legal_entity, tenant_id"
            if tenant_id:
                result = await db.execute(
                    text(f"SELECT {select_cols} FROM twin.company WHERE tenant_id = :tid ORDER BY name"),
                    {"tid": tenant_id},
                )
            else:
                result = await db.execute(
                    text(f"SELECT {select_cols} FROM twin.company ORDER BY tenant_id NULLS LAST, name")
                )
        else:
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
            "tenant_id":    getattr(r, "tenant_id", None),
        }
        for r in rows
    ]
