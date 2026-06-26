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
from api.dependencies import require_tenant
from api.schemas import DimEdge, DimEdgeCreate, Page

router = APIRouter()


async def _assert_node_owned(db: AsyncSession, node_id: str, tenant_id: str) -> None:
    """Raise 404 if the node's company does not belong to the tenant."""
    row = await db.execute(
        text("""
            SELECT 1 FROM twin.dim_node n
            JOIN twin.company c ON c.id = n.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE n.id = :nid
        """),
        {"nid": node_id, "tid": tenant_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Node not found")


@router.get("", response_model=Page)
async def list_dim_edges(
    company_id:  UUID,
    tenant_id: str = Depends(require_tenant),
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

    # Enforce tenant ownership by joining through the source node's company
    filters = ["sn.company_id = :company_id", "(c.tenant_id = :tenant_id OR c.tenant_id IS NULL)"]
    params: dict = {"company_id": str(company_id), "tenant_id": tenant_id}

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
            JOIN twin.company c ON c.id = sn.company_id
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
            JOIN twin.company c ON c.id = sn.company_id
            WHERE {where}
            ORDER BY e.weight DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    items = [dict(r._mapping) for r in rows]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.get("/{edge_id}", response_model=DimEdge)
async def get_dim_edge(edge_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT e.*,
                   sn.label AS source_label,
                   tn.label AS target_label
            FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            JOIN twin.dim_node tn ON tn.id = e.target_id
            JOIN twin.company c ON c.id = sn.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE e.id = :id
        """),
        {"id": str(edge_id), "tid": tenant_id},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Edge not found")
    return dict(result)


@router.post("", response_model=DimEdge, status_code=201)
async def create_dim_edge(body: DimEdgeCreate, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    # Verify source node belongs to this tenant
    await _assert_node_owned(db, str(body.source_id), tenant_id)

    # Verify target node belongs to this tenant (both nodes must be in same tenant)
    await _assert_node_owned(db, str(body.target_id), tenant_id)

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
async def soft_delete_edge(edge_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    """Soft delete — sets valid_to = now()."""

    # Verify the edge belongs to this tenant before deleting
    check = await db.execute(
        text("""
            SELECT 1 FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            JOIN twin.company c ON c.id = sn.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE e.id = :id
        """),
        {"id": str(edge_id), "tid": tenant_id},
    )
    if not check.scalar():
        raise HTTPException(status_code=404, detail="Edge not found")

    await db.execute(
        text("UPDATE twin.dim_edge SET valid_to = now() WHERE id = :id AND valid_to IS NULL"),
        {"id": str(edge_id)},
    )
    await db.commit()
