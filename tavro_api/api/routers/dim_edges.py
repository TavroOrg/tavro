# =============================================================
# api/routers/dim_edges.py
# =============================================================

from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json

from api.database import get_db
from api.schemas import DimEdge, DimEdgeCreate, Page

router = APIRouter()


@router.get("", response_model=Page)
async def list_dim_edges(
    company_id:  UUID,
    node_id:     Optional[UUID] = None,
    rel_type:    Optional[str]  = None,
    active_only: bool           = True,
    offset:      int            = Query(0, ge=0),
    limit:       int            = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """
    List edges for a company. Optionally filter by a specific node
    (returns both outbound and inbound edges for that node).
    """
    filters = ["sn.company_id = :company_id"]
    params: dict = {"company_id": str(company_id)}

    if active_only:
        filters.append("e.valid_to IS NULL")
    if node_id:
        filters.append("(e.source_id = :node_id OR e.target_id = :node_id)")
        params["node_id"] = str(node_id)
    if rel_type:
        filters.append("e.rel_type = :rel_type")
        params["rel_type"] = rel_type

    where = " AND ".join(filters)

    count_row = await db.execute(
        text(f"""
            SELECT count(*) FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            WHERE {where}
        """),
        params,
    )
    total = count_row.scalar()

    rows = await db.execute(
        text(f"""
            SELECT e.*,
                   sn.label AS source_label,
                   tn.label AS target_label
            FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            JOIN twin.dim_node tn ON tn.id = e.target_id
            WHERE {where}
            ORDER BY e.weight DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    items = [dict(r._mapping) for r in rows]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.get("/{edge_id}", response_model=DimEdge)
async def get_dim_edge(edge_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT e.*,
                   sn.label AS source_label,
                   tn.label AS target_label
            FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            JOIN twin.dim_node tn ON tn.id = e.target_id
            WHERE e.id = :id
        """),
        {"id": str(edge_id)},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Edge not found")
    return dict(result)


@router.post("", response_model=DimEdge, status_code=201)
async def create_dim_edge(body: DimEdgeCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            INSERT INTO twin.dim_edge
                (source_id, target_id, rel_type, weight, meta)
            VALUES
                (:source_id, :target_id, :rel_type, :weight, cast(:meta as jsonb))
            RETURNING *
        """),
        {
            "source_id": str(body.source_id),
            "target_id": str(body.target_id),
            "rel_type":  body.rel_type,
            "weight":    body.weight,
            "meta":      json.dumps(body.meta),
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.delete("/{edge_id}", status_code=204)
async def soft_delete_edge(edge_id: UUID, db: AsyncSession = Depends(get_db)):
    """Soft delete — sets valid_to = now()."""
    await db.execute(
        text("UPDATE twin.dim_edge SET valid_to = now() WHERE id = :id AND valid_to IS NULL"),
        {"id": str(edge_id)},
    )
    await db.commit()
