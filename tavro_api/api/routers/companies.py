# =============================================================
# api/routers/companies.py
# =============================================================

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.events import broadcaster
from api.schemas import Company, CompanyCreate, CompanyUpdate, Page

router = APIRouter()


@router.get("", response_model=Page)
async def list_companies(
    offset: int = Query(0, ge=0),
    limit:  int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(text("SELECT count(*) FROM twin.company"))
    total = count_result.scalar()

    rows = await db.execute(
        text("SELECT * FROM twin.company ORDER BY name LIMIT :limit OFFSET :offset"),
        {"limit": limit, "offset": offset},
    )
    items = [dict(r._mapping) for r in rows]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.get("/{company_id}", response_model=Company)
async def get_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM twin.company WHERE id = :id"),
        {"id": str(company_id)},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Company not found")
    return dict(result)


@router.post("", response_model=Company, status_code=201)
async def create_company(body: CompanyCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            INSERT INTO twin.company (name, industry, region, legal_entity)
            VALUES (:name, :industry, :region, :legal_entity)
            RETURNING *
        """),
        body.model_dump(),
    )
    await db.commit()
    result = dict(row.mappings().first())
    await broadcaster.publish({"entity": "company", "action": "create", "id": str(result.get("id", ""))})
    return result


@router.patch("/{company_id}", response_model=Company)
async def update_company(
    company_id: UUID,
    body: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = str(company_id)

    row = await db.execute(
        text(f"UPDATE twin.company SET {set_clause} WHERE id = :id RETURNING *"),
        updates,
    )
    await db.commit()
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Company not found")
    await broadcaster.publish({"entity": "company", "action": "update", "id": str(company_id)})
    return dict(result)


@router.delete("/{company_id}", status_code=200)
async def delete_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Delete a company and all related objects.

    Cascade order (Postgres handles most automatically via ON DELETE CASCADE):
      1. dim_edge rows where source or target node belongs to this company
      2. source_ref rows for this company's nodes
      3. dim_node rows for this company
      4. company row itself

    context_log rows are intentionally kept as an immutable audit trail.
    AGE graph nodes for this company are also cleaned up.

    Returns a summary of what was deleted.
    """
    cid = str(company_id)

    # Verify company exists first
    row = await db.execute(
        text("SELECT name FROM twin.company WHERE id = :id"),
        {"id": cid},
    )
    company = row.mappings().first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    company_name = company["name"]

    # Count what will be deleted (for the response summary)
    counts = {}
    for table, col in [
        ("twin.dim_node",   "company_id"),
        ("twin.source_ref", "dim_node_id"),
        ("twin.dim_edge",   "source_id"),
    ]:
        if table == "twin.dim_node":
            r = await db.execute(
                text(f"SELECT count(*) FROM {table} WHERE {col} = :cid"),
                {"cid": cid},
            )
        elif table == "twin.source_ref":
            r = await db.execute(
                text("""SELECT count(*) FROM twin.source_ref
                        WHERE dim_node_id IN (
                            SELECT id FROM twin.dim_node WHERE company_id = :cid
                        )"""),
                {"cid": cid},
            )
        else:
            r = await db.execute(
                text("""SELECT count(*) FROM twin.dim_edge
                        WHERE source_id IN (
                            SELECT id FROM twin.dim_node WHERE company_id = :cid
                        )"""),
                {"cid": cid},
            )
        counts[table.split(".")[1]] = r.scalar()

    # Count orphaned context_log rows (kept, not deleted)
    log_row = await db.execute(
        text("SELECT count(*) FROM twin.context_log WHERE company_id = :cid"),
        {"cid": cid},
    )
    log_count = log_row.scalar()

    # Delete AGE graph nodes for this company's dim_nodes
    # (best effort — don't fail the whole operation if AGE cleanup errors)
    try:
        await db.execute(text("LOAD 'age'"))
        await db.execute(text("SET search_path = ag_catalog, twin, public"))
        node_rows = await db.execute(
            text("SELECT id FROM twin.dim_node WHERE company_id = :cid"),
            {"cid": cid},
        )
        node_ids = [str(r.id) for r in node_rows]
        for nid in node_ids:
            await db.execute(
                text(f"""
                    SELECT * FROM ag_catalog.cypher('twin_graph', $$
                        MATCH (n:DimNode {{id: '{nid}'}})
                        DETACH DELETE n
                    $$) AS (result ag_catalog.agtype)
                """)
            )
    except Exception:
        pass  # AGE cleanup is best-effort

    # Delete the company — Postgres cascades handle dim_node, dim_edge, source_ref
    await db.execute(
        text("DELETE FROM twin.company WHERE id = :id"),
        {"id": cid},
    )
    await db.commit()

    await broadcaster.publish({"entity": "company", "action": "delete", "id": str(company_id)})
    return {
        "deleted": {
            "company":    company_name,
            "dim_nodes":  counts.get("dim_node",   0),
            "dim_edges":  counts.get("dim_edge",   0),
            "source_refs": counts.get("source_ref", 0),
        },
        "retained": {
            "context_log_rows": log_count,
            "reason": "Audit logs are kept as an immutable trail even after company deletion.",
        },
    }
