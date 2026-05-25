# =============================================================
# api/routers/source_refs.py
# =============================================================

from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import httpx

from api.database import get_db
from api.schemas import SourceRef, SourceRefCreate, SourceRefDetail

router = APIRouter()


@router.get("/node/{node_id}", response_model=list[SourceRef])
async def list_source_refs(node_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text("SELECT * FROM twin.source_ref WHERE dim_node_id = :id ORDER BY system_name"),
        {"id": str(node_id)},
    )
    return [dict(r._mapping) for r in rows]


@router.post("", response_model=SourceRef, status_code=201)
async def create_source_ref(body: SourceRefCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            INSERT INTO twin.source_ref
                (dim_node_id, system_name, external_id, mcp_tool)
            VALUES
                (:dim_node_id, :system_name, :external_id, :mcp_tool)
            RETURNING *
        """),
        {
            "dim_node_id": str(body.dim_node_id),
            "system_name": body.system_name,
            "external_id": body.external_id,
            "mcp_tool":    body.mcp_tool,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.delete("/{ref_id}", status_code=204)
async def delete_source_ref(ref_id: UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM twin.source_ref WHERE id = :id"),
        {"id": str(ref_id)},
    )
    await db.commit()


@router.post("/{ref_id}/fetch", response_model=SourceRefDetail)
async def fetch_source_detail(ref_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Trigger a drill-down fetch from the source system.
    In production this calls the registered MCP tool.
    For dev, returns a stub so the UI flow is testable end-to-end.
    """
    row = await db.execute(
        text("SELECT * FROM twin.source_ref WHERE id = :id"),
        {"id": str(ref_id)},
    )
    ref = row.mappings().first()
    if not ref:
        raise HTTPException(status_code=404, detail="Source ref not found")

    ref = dict(ref)
    fetched_at = datetime.now(timezone.utc)

    # Update last_synced
    await db.execute(
        text("UPDATE twin.source_ref SET last_synced = :ts WHERE id = :id"),
        {"ts": fetched_at, "id": str(ref_id)},
    )
    await db.commit()

    # ── Stub responses per system (replace with real MCP calls) ──
    stub_detail = {
        "stub":       True,
        "system":     ref["system_name"],
        "external_id": ref["external_id"],
        "mcp_tool":   ref["mcp_tool"],
        "message":    f"Connect your {ref['system_name']} MCP server to fetch live data.",
        "sample_fields": {
            "status":       "active",
            "owner":        "to be fetched from source",
            "last_updated": "to be fetched from source",
        },
    }

    return SourceRefDetail(
        source_ref=SourceRef(**ref),
        detail=stub_detail,
        fetched_at=fetched_at,
    )
