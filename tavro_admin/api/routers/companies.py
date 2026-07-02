"""
Company listing endpoint for the Admin Portal.
Reads from twin.company — same table the main portal uses.
Scoped to the caller's own tenant, resolved from their auth claims (or the
x-tenant-id header override), so admins only ever see their own companies.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.dependencies.auth import require_portal_admin

router = APIRouter()


@router.get("/companies")
async def list_companies(
    request: Request,
    auth: dict = Depends(require_portal_admin),
):
    tenant_id: str | None = (
        request.headers.get("x-tenant-id", "").strip() or
        auth.get("tenant_id") or
        None
    )
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve your organisation ID. "
                   "Set TAVRO_ADMIN_TENANT_ID in the environment, or ensure ZITADEL "
                   "includes org claims in its userinfo response.",
        )

    async with AsyncSessionLocal() as db:
        col_check = await db.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'twin' AND table_name = 'company' AND column_name = 'tenant_id'"
            )
        )
        has_tenant_id = col_check.first() is not None

        if not has_tenant_id:
            # Schema not migrated yet — no tenant_id column to filter on.
            return []

        result = await db.execute(
            text(
                "SELECT id, name, industry, region, legal_entity, tenant_id "
                "FROM twin.company WHERE tenant_id = :tid ORDER BY name"
            ),
            {"tid": tenant_id},
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
