"""
Company listing endpoint for the Admin Portal.
Reads from twin.company — same table the main portal uses.
Scoped to the caller's own tenant, resolved from their auth claims (or the
x-tenant-id header override), so admins only ever see their own companies.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.dependencies.auth import require_portal_admin

router = APIRouter()

DEFAULT_PRIORITY_WEIGHTS = {"BV": 0.55, "TC": 0.20, "RISK": 0.25}
DEFAULT_RISK_WEIGHTS = {
    "data_privacy": 20,
    "operational": 20,
    "compliance": 20,
    "ai_behavioral": 20,
    "strategic_reputational": 20,
}


class RoadmapConfigUpdate(BaseModel):
    priority_weights: dict[str, float] | None = None
    risk_weights: dict[str, float] | None = None


def _json_dict(value: Any, default: dict) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else default
        except json.JSONDecodeError:
            return default
    return default


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


@router.get("/companies/{company_id}/roadmap-config")
async def get_roadmap_config(
    company_id: UUID,
    auth: dict = Depends(require_portal_admin),
):
    async with AsyncSessionLocal() as db:
        row = await db.execute(
            text("""
                SELECT priority_weights, risk_weights FROM twin.company_preferences
                WHERE company_id = :id
            """),
            {"id": str(company_id)},
        )
        result = row.mappings().first()
    if not result:
        return {"priorityWeights": DEFAULT_PRIORITY_WEIGHTS, "riskWeights": DEFAULT_RISK_WEIGHTS}
    return {
        "priorityWeights": _json_dict(result["priority_weights"], DEFAULT_PRIORITY_WEIGHTS),
        "riskWeights": _json_dict(result["risk_weights"], DEFAULT_RISK_WEIGHTS),
    }


@router.patch("/companies/{company_id}/roadmap-config")
async def update_roadmap_config(
    company_id: UUID,
    body: RoadmapConfigUpdate,
    request: Request,
    auth: dict = Depends(require_portal_admin),
):
    """Admin-only: upserts the company's roadmap scoring weights."""
    if body.priority_weights is None and body.risk_weights is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    tenant_id: str | None = (
        request.headers.get("x-tenant-id", "").strip() or
        auth.get("tenant_id") or
        None
    )
    cid = str(company_id)

    try:
        async with AsyncSessionLocal() as db:
            company_row = await db.execute(
                text("SELECT id FROM twin.company WHERE id = :id"),
                {"id": cid},
            )
            if company_row.first() is None:
                raise HTTPException(status_code=404, detail="Company not found")

            existing = await db.execute(
                text("SELECT company_id FROM twin.company_preferences WHERE company_id = :id"),
                {"id": cid},
            )

            if existing.first() is not None:
                set_clauses = []
                params: dict = {"id": cid}
                if body.priority_weights is not None:
                    set_clauses.append("priority_weights = :priority_weights")
                    params["priority_weights"] = json.dumps(body.priority_weights)
                if body.risk_weights is not None:
                    set_clauses.append("risk_weights = :risk_weights")
                    params["risk_weights"] = json.dumps(body.risk_weights)
                row = await db.execute(
                    text(f"""
                        UPDATE twin.company_preferences
                        SET {', '.join(set_clauses)}
                        WHERE company_id = :id
                        RETURNING priority_weights, risk_weights
                    """),
                    params,
                )
            else:
                row = await db.execute(
                    text("""
                        INSERT INTO twin.company_preferences (company_id, tenant_id, priority_weights, risk_weights)
                        VALUES (:company_id, :tenant_id, :priority_weights, :risk_weights)
                        RETURNING priority_weights, risk_weights
                    """),
                    {
                        "company_id": cid,
                        "tenant_id": tenant_id,
                        "priority_weights": json.dumps(body.priority_weights if body.priority_weights is not None else DEFAULT_PRIORITY_WEIGHTS),
                        "risk_weights": json.dumps(body.risk_weights if body.risk_weights is not None else DEFAULT_RISK_WEIGHTS),
                    },
                )

            await db.commit()
            result = row.mappings().first()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save roadmap configuration: {exc}")

    return {
        "priorityWeights": _json_dict(result["priority_weights"], DEFAULT_PRIORITY_WEIGHTS),
        "riskWeights": _json_dict(result["risk_weights"], DEFAULT_RISK_WEIGHTS),
    }
