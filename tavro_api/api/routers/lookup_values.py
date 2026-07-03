# =============================================================
# api/routers/lookup_values.py
#
# Generic key/value picklist source: public.lookup holds the
# selectable options for any (table_name, column_name) pair, e.g.
# ('ai_use_cases', 'status'). Adding/editing/deactivating rows there
# changes what shows up in the corresponding dropdown/button-group
# in the UI, without a code change.
# =============================================================

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


@router.get("", summary="List lookup values for a table/column")
async def list_lookup_values(
    table_name: str = Query(...),
    column_name: str = Query(...),
    request: Request = None,
    company_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _tenant(request)
    conditions = ["table_name = :table_name", "column_name = :column_name", "active = TRUE"]
    params = {"table_name": table_name, "column_name": column_name}

    # Strict tenant scoping: only rows belonging to this exact tenant are
    # visible. A tenant never sees another tenant's values.
    if tenant_id:
        conditions.append("tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    else:
        conditions.append("tenant_id IS NULL")

    if company_id:
        conditions.append("company_id = :company_id")
        params["company_id"] = company_id
    else:
        conditions.append("company_id IS NULL")

    where_clause = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, label, value, description, sequence, is_default
            FROM public.lookup
            WHERE {where_clause}
            ORDER BY sequence, label
        """),
        params,
    )
    return [dict(r._mapping) for r in result]


@router.get("/all", summary="List every active lookup value for this tenant, across all fields")
async def list_all_lookup_values(
    request: Request = None,
    company_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    One call, one payload: every active picklist option this tenant can see,
    for every (table_name, column_name) pair. Meant to be fetched once when
    the portal loads and cached client-side, instead of one request per field.
    """
    tenant_id = _tenant(request)
    conditions = ["active = TRUE"]
    params = {}

    if tenant_id:
        conditions.append("tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    else:
        conditions.append("tenant_id IS NULL")

    if company_id:
        conditions.append("company_id = :company_id")
        params["company_id"] = company_id
    else:
        conditions.append("company_id IS NULL")

    where_clause = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, table_name, column_name, label, value, description, sequence, is_default
            FROM public.lookup
            WHERE {where_clause}
            ORDER BY table_name, column_name, sequence, label
        """),
        params,
    )
    return [dict(r._mapping) for r in result]
