"""
Reference Tables (custom lookup values) for the Admin Portal.

Lets admins override the choice options shown for a dropdown field elsewhere
in the portal (e.g. Business Criticality on a Process) without a code change.
public.lookup stores one row per choice value; a "field" is the full set of
rows sharing the same (tenant_id, company_id, table_name, column_name).

Editing a field's choice list is an upsert against that set: rows whose id
is still present get updated in place, rows with no id are newly added, and
rows that existed before but were dropped from the submitted list get
deleted — so ids and created_ts survive edits instead of being recreated.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text

from api.database import AsyncSessionLocal

router = APIRouter()


def _resolve_tenant_id(request: Request) -> str:
    tenant_id = request.headers.get("x-tenant-id", "").strip() or None
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve your organisation ID (missing x-tenant-id header).",
        )
    return tenant_id


def _resolve_company_id(request: Request) -> str | None:
    return request.headers.get("x-company-id", "").strip() or None


def _validate_options(raw_options: Any) -> list[dict]:
    if not isinstance(raw_options, list) or len(raw_options) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 options.")

    cleaned: list[dict] = []
    seen_labels: set[str] = set()
    default_count = 0
    for index, opt in enumerate(raw_options):
        if not isinstance(opt, dict):
            raise HTTPException(status_code=400, detail="Each option must be an object.")
        label = str(opt.get("label", "")).strip()
        if not label:
            raise HTTPException(status_code=400, detail="Every option needs a label.")
        if label in seen_labels:
            raise HTTPException(status_code=400, detail=f"Duplicate option: {label!r}")
        seen_labels.add(label)

        is_default = bool(opt.get("is_default", False))
        default_count += 1 if is_default else 0

        description = str(opt.get("description") or "").strip() or None

        row_id = opt.get("id")
        cleaned.append({
            "id": str(row_id) if row_id else None,
            "label": label,
            "value": label,
            "description": description,
            "sequence": index,
            "is_default": is_default,
            "active": bool(opt.get("active", True)),
        })

    if default_count != 1:
        raise HTTPException(status_code=400, detail="Pick exactly one default option.")

    return cleaned


def _row_to_option(row) -> dict:
    return {
        "id":          row.id,
        "label":       row.label,
        "value":       row.value,
        "description": row.description,
        "sequence":    row.sequence,
        "is_default":  row.is_default,
        "active":      row.active,
        "created_ts":  row.created_ts.isoformat() if row.created_ts else None,
        "updated_ts":  row.updated_ts.isoformat() if row.updated_ts else None,
    }


_INSERT_SQL = text(
    "INSERT INTO public.lookup "
    "(id, tenant_id, company_id, table_name, column_name, label, value, description, "
    "sequence, is_default, active, created_ts, updated_ts) "
    "VALUES (:id, :tenant_id, :company_id, :table_name, :column_name, :label, :value, :description, "
    ":sequence, :is_default, :active, :created_ts, :updated_ts)"
)


@router.get("/lookups")
async def list_lookups(request: Request):
    tenant_id = _resolve_tenant_id(request)
    company_id = _resolve_company_id(request)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                "SELECT id, tenant_id, company_id, table_name, column_name, label, value, description, "
                "sequence, is_default, active, created_ts, updated_ts "
                "FROM public.lookup "
                "WHERE tenant_id = :tid AND company_id IS NOT DISTINCT FROM :cid "
                "ORDER BY table_name, column_name, sequence"
            ),
            {"tid": tenant_id, "cid": company_id},
        )
        rows = result.fetchall()

    groups: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []
    for r in rows:
        key = (r.table_name, r.column_name)
        if key not in groups:
            groups[key] = {
                "table_name":  r.table_name,
                "column_name": r.column_name,
                "tenant_id":   r.tenant_id,
                "company_id":  r.company_id,
                "options":     [],
            }
            order.append(key)
        groups[key]["options"].append(_row_to_option(r))

    return [groups[k] for k in order]


@router.post("/lookups")
async def create_lookup_group(request: Request, payload: dict):
    tenant_id = _resolve_tenant_id(request)
    company_id = _resolve_company_id(request)

    table_name = str(payload.get("table_name", "")).strip()
    column_name = str(payload.get("column_name", "")).strip()
    if not table_name or not column_name:
        raise HTTPException(status_code=400, detail="table_name and column_name are required.")

    options = _validate_options(payload.get("options"))
    now = datetime.utcnow()

    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            text(
                "SELECT 1 FROM public.lookup WHERE tenant_id = :tid "
                "AND company_id IS NOT DISTINCT FROM :cid "
                "AND table_name = :table_name AND column_name = :column_name LIMIT 1"
            ),
            {"tid": tenant_id, "cid": company_id, "table_name": table_name, "column_name": column_name},
        )
        if existing.first() is not None:
            raise HTTPException(
                status_code=409,
                detail="A reference config already exists for this field. Edit it instead.",
            )

        for opt in options:
            await db.execute(_INSERT_SQL, {
                "id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "company_id": company_id,
                "table_name": table_name,
                "column_name": column_name,
                "label": opt["label"],
                "value": opt["value"],
                "description": opt["description"],
                "sequence": opt["sequence"],
                "is_default": opt["is_default"],
                "active": opt["active"],
                "created_ts": now,
                "updated_ts": now,
            })
        await db.commit()

    return {"status": "success"}


@router.put("/lookups/{table_name}/{column_name}")
async def update_lookup_group(table_name: str, column_name: str, request: Request, payload: dict):
    tenant_id = _resolve_tenant_id(request)
    company_id = _resolve_company_id(request)
    options = _validate_options(payload.get("options"))
    now = datetime.utcnow()

    async with AsyncSessionLocal() as db:
        existing_result = await db.execute(
            text(
                "SELECT id FROM public.lookup WHERE tenant_id = :tid "
                "AND company_id IS NOT DISTINCT FROM :cid "
                "AND table_name = :table_name AND column_name = :column_name"
            ),
            {"tid": tenant_id, "cid": company_id, "table_name": table_name, "column_name": column_name},
        )
        existing_ids = {row.id for row in existing_result.fetchall()}
        if not existing_ids:
            raise HTTPException(status_code=404, detail="Reference config not found.")

        submitted_ids = {opt["id"] for opt in options if opt["id"]}
        to_delete = existing_ids - submitted_ids
        if to_delete:
            await db.execute(
                text("DELETE FROM public.lookup WHERE id = ANY(:ids)"),
                {"ids": list(to_delete)},
            )

        for opt in options:
            if opt["id"] and opt["id"] in existing_ids:
                await db.execute(
                    text(
                        "UPDATE public.lookup SET label = :label, value = :value, description = :description, "
                        "sequence = :sequence, is_default = :is_default, active = :active, "
                        "updated_ts = :updated_ts WHERE id = :id"
                    ),
                    {
                        "label": opt["label"],
                        "value": opt["value"],
                        "description": opt["description"],
                        "sequence": opt["sequence"],
                        "is_default": opt["is_default"],
                        "active": opt["active"],
                        "updated_ts": now,
                        "id": opt["id"],
                    },
                )
            else:
                await db.execute(_INSERT_SQL, {
                    "id": str(uuid.uuid4()),
                    "tenant_id": tenant_id,
                    "company_id": company_id,
                    "table_name": table_name,
                    "column_name": column_name,
                    "label": opt["label"],
                    "value": opt["value"],
                    "description": opt["description"],
                    "sequence": opt["sequence"],
                    "is_default": opt["is_default"],
                    "active": opt["active"],
                    "created_ts": now,
                    "updated_ts": now,
                })
        await db.commit()

    return {"status": "success"}


@router.delete("/lookups/{table_name}/{column_name}")
async def delete_lookup_group(table_name: str, column_name: str, request: Request):
    tenant_id = _resolve_tenant_id(request)
    company_id = _resolve_company_id(request)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(
                "DELETE FROM public.lookup WHERE tenant_id = :tid "
                "AND company_id IS NOT DISTINCT FROM :cid "
                "AND table_name = :table_name AND column_name = :column_name"
            ),
            {"tid": tenant_id, "cid": company_id, "table_name": table_name, "column_name": column_name},
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Reference config not found.")

    return {"status": "success"}
