# =============================================================
# api/routers/graph.py
# AGE-backed graph traversal endpoints for visualisation
# =============================================================

from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.schemas import GraphResponse, GraphNode, GraphEdge

router = APIRouter()


@router.get("/company/{company_id}", response_model=GraphResponse)
async def get_company_graph(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Full graph for a company — all active nodes and edges.
    Used by the React graph visualiser as its primary data source.
    Fetched from Postgres relational tables (reliable, no AGE quirks).
    """
    # Nodes
    node_rows = await db.execute(
        text("""
            SELECT n.id, n.label, t.category AS type
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE n.company_id = :company_id
              AND n.valid_to IS NULL
            ORDER BY t.category, n.label
        """),
        {"company_id": str(company_id)},
    )
    nodes = [
        GraphNode(
            id=str(r.id),
            label=r.label,
            type=r.type,
            group=r.type,
        )
        for r in node_rows
    ]

    # Edges — only between nodes belonging to this company
    edge_rows = await db.execute(
        text("""
            SELECT e.id, e.source_id, e.target_id, e.rel_type, e.weight
            FROM twin.dim_edge e
            JOIN twin.dim_node sn ON sn.id = e.source_id
            WHERE sn.company_id = :company_id
              AND e.valid_to IS NULL
        """),
        {"company_id": str(company_id)},
    )
    edges = [
        GraphEdge(
            id=str(r.id),
            source=str(r.source_id),
            target=str(r.target_id),
            rel_type=r.rel_type,
            weight=r.weight,
        )
        for r in edge_rows
    ]

    return GraphResponse(nodes=nodes, edges=edges)


@router.get("/node/{node_id}/neighbourhood", response_model=GraphResponse)
async def get_node_neighbourhood(
    node_id: UUID,
    hops:    int = Query(default=2, ge=1, le=3),
    db: AsyncSession = Depends(get_db),
):
    """
    N-hop neighbourhood around a single node.
    Uses a recursive CTE — no AGE dependency, works reliably.
    Used when a user clicks a node in the visualiser to expand context.
    """
    rows = await db.execute(
        text("""
            WITH RECURSIVE neighbourhood AS (
                -- Base: the node itself
                SELECT id, 0 AS depth
                FROM twin.dim_node
                WHERE id = :node_id AND valid_to IS NULL

                UNION ALL

                -- Expand both inbound and outbound edges from the current frontier
                SELECT CASE
                         WHEN e.source_id = n.id THEN e.target_id
                         ELSE e.source_id
                       END AS id,
                       n.depth + 1
                FROM neighbourhood n
                JOIN twin.dim_edge e ON (e.source_id = n.id OR e.target_id = n.id)
                WHERE e.valid_to IS NULL
                  AND n.depth < :hops
            )
            SELECT DISTINCT
                dn.id, dn.label, t.category AS type
            FROM neighbourhood nb
            JOIN twin.dim_node dn ON dn.id = nb.id
            JOIN twin.dim_type t  ON t.id = dn.dim_type_id
        """),
        {"node_id": str(node_id), "hops": hops},
    )
    node_ids = set()
    nodes = []
    for r in rows:
        nodes.append(GraphNode(id=str(r.id), label=r.label, type=r.type, group=r.type))
        node_ids.add(str(r.id))

    if not node_ids:
        raise HTTPException(status_code=404, detail="Node not found")

    # Edges between nodes in the neighbourhood
    placeholders = ", ".join(f"'{nid}'" for nid in node_ids)
    edge_rows = await db.execute(
        text(f"""
            SELECT e.id, e.source_id, e.target_id, e.rel_type, e.weight
            FROM twin.dim_edge e
            WHERE e.source_id IN ({placeholders})
              AND e.target_id IN ({placeholders})
              AND e.valid_to IS NULL
        """)
    )
    edges = [
        GraphEdge(
            id=str(r.id),
            source=str(r.source_id),
            target=str(r.target_id),
            rel_type=r.rel_type,
            weight=r.weight,
        )
        for r in edge_rows
    ]

    return GraphResponse(nodes=nodes, edges=edges)


@router.get("/node/{node_id}/paths", response_model=GraphResponse)
async def get_paths_to_risks(
    node_id: UUID,
    target_category: str = Query(default="risk"),
    db: AsyncSession = Depends(get_db),
):
    """
    Find all paths from a given node to nodes of a target category
    (default: risk). Useful for 'what risks does this process touch?'
    """
    rows = await db.execute(
        text("""
            WITH RECURSIVE paths AS (
                SELECT id, 0 AS depth
                FROM twin.dim_node
                WHERE id = :node_id AND valid_to IS NULL

                UNION

                SELECT e.target_id, p.depth + 1
                FROM paths p
                JOIN twin.dim_edge e ON e.source_id = p.id
                WHERE e.valid_to IS NULL AND p.depth < 4
            )
            SELECT DISTINCT
                dn.id, dn.label, t.category AS type
            FROM paths p
            JOIN twin.dim_node dn ON dn.id = p.id
            JOIN twin.dim_type t  ON t.id = dn.dim_type_id
            WHERE t.category = :target_category
               OR dn.id = :node_id
        """),
        {"node_id": str(node_id), "target_category": target_category},
    )
    node_ids = set()
    nodes = []
    for r in rows:
        nodes.append(GraphNode(id=str(r.id), label=r.label, type=r.type, group=r.type))
        node_ids.add(str(r.id))

    placeholders = ", ".join(f"'{nid}'" for nid in node_ids)
    edge_rows = await db.execute(
        text(f"""
            SELECT e.id, e.source_id, e.target_id, e.rel_type, e.weight
            FROM twin.dim_edge e
            WHERE e.source_id IN ({placeholders})
              AND e.target_id IN ({placeholders})
              AND e.valid_to IS NULL
        """)
    )
    edges = [
        GraphEdge(
            id=str(r.id),
            source=str(r.source_id),
            target=str(r.target_id),
            rel_type=r.rel_type,
            weight=r.weight,
        )
        for r in edge_rows
    ]

    return GraphResponse(nodes=nodes, edges=edges)
