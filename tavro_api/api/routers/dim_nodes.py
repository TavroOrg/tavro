# =============================================================
# api/routers/dim_nodes.py
# =============================================================

from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json

from api.database import get_db
from api.schemas import DimNode, DimNodeCreate, DimNodeUpdate, Page, AttachmentOut
from api.routers.business_relations import sync_dim_node_to_business_entity

router = APIRouter()


@router.get("", response_model=Page)
async def list_dim_nodes(
    company_id:  UUID,
    dim_type_id: Optional[UUID]  = None,
    category:    Optional[str]   = None,
    search:      Optional[str]   = None,
    active_only: bool            = True,
    offset:      int             = Query(0, ge=0),
    limit:       int             = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    filters = ["n.company_id = :company_id"]
    params: dict = {"company_id": str(company_id)}

    if active_only:
        filters.append("n.valid_to IS NULL")
    if dim_type_id:
        filters.append("n.dim_type_id = :dim_type_id")
        params["dim_type_id"] = str(dim_type_id)
    if category:
        filters.append("t.category = :category")
        params["category"] = category
    if search:
        filters.append(
            "to_tsvector('english', coalesce(n.label,'') || ' ' || coalesce(n.summary,'')) "
            "@@ plainto_tsquery('english', :search)"
        )
        params["search"] = search

    where = " AND ".join(filters)

    count_row = await db.execute(
        text(f"""
            SELECT count(*) FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE {where}
        """),
        params,
    )
    total = count_row.scalar()

    rows = await db.execute(
        text(f"""
            SELECT n.*,
                   t.name     AS dim_type_name,
                   t.category AS category
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE {where}
            ORDER BY t.category, n.label
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    items = [dict(r._mapping) for r in rows]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.get("/{node_id}", response_model=DimNode)
async def get_dim_node(node_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT n.*,
                   t.name     AS dim_type_name,
                   t.category AS category
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            WHERE n.id = :id
        """),
        {"id": str(node_id)},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return dict(result)


@router.post("", response_model=DimNode, status_code=201)
async def create_dim_node(body: DimNodeCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            INSERT INTO twin.dim_node
                (company_id, dim_type_id, label, summary, tags, visibility, sensitive, valid_from)
            VALUES
                (:company_id, :dim_type_id, :label, :summary, cast(:tags as jsonb),
                 :visibility, :sensitive, coalesce(:valid_from, now()))
            RETURNING *
        """),
        {
            **body.model_dump(),
            "company_id":  str(body.company_id),
            "dim_type_id": str(body.dim_type_id),
            "tags":        json.dumps(body.tags),
            "valid_from":  body.valid_from,
        },
    )
    await db.commit()
    node = dict(row.mappings().first())

    # When creating a dim_node under application/process/integration, auto-create the business entity record
    try:
        type_row = await db.execute(
            text("SELECT category FROM twin.dim_type WHERE id = :id"),
            {"id": str(body.dim_type_id)},
        )
        type_result = type_row.mappings().first()
        if type_result and type_result["category"] in ("application", "process", "integration"):
            company_row = await db.execute(
                text("SELECT name FROM twin.company WHERE id = :id LIMIT 1"),
                {"id": str(body.company_id)},
            )
            company = company_row.mappings().first()
            company_name = company["name"] if company else None
            await sync_dim_node_to_business_entity(
                db,
                str(body.company_id),
                company_name,
                type_result["category"],
                body.label,
                body.summary,
            )
    except Exception:
        pass  # Non-fatal — dim_node was already committed

    return node


@router.patch("/{node_id}", response_model=DimNode)
async def update_dim_node(
    node_id: UUID,
    body: DimNodeUpdate,
    db: AsyncSession = Depends(get_db),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "dim_type_id" in updates:
        updates["dim_type_id"] = str(updates["dim_type_id"])
    if "tags" in updates:
        updates["tags"] = json.dumps(updates["tags"])
    set_parts = [
        f"{k} = cast(:{k} as jsonb)" if k == "tags" else f"{k} = :{k}"
        for k in updates
    ]

    updates["id"] = str(node_id)
    set_clause = ", ".join(set_parts)

    row = await db.execute(
        text(f"UPDATE twin.dim_node SET {set_clause} WHERE id = :id RETURNING *"),
        updates,
    )
    await db.commit()
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return dict(result)


@router.delete("/{node_id}", status_code=204)
async def soft_delete_dim_node(node_id: UUID, db: AsyncSession = Depends(get_db)):
    """Soft delete — sets valid_to = now() rather than deleting the row."""
    await db.execute(
        text("UPDATE twin.dim_node SET valid_to = now() WHERE id = :id AND valid_to IS NULL"),
        {"id": str(node_id)},
    )
    await db.commit()


# ── Attachments ──────────────────────────────────────────────────────────────

@router.get("/{node_id}/attachments", response_model=List[AttachmentOut])
async def list_attachments(node_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text("""
            SELECT id, node_id, filename, content_type, size_bytes, uploaded_at
            FROM twin.dim_node_attachment
            WHERE node_id = :node_id
            ORDER BY uploaded_at
        """),
        {"node_id": str(node_id)},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{node_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    node_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    row = await db.execute(
        text("""
            INSERT INTO twin.dim_node_attachment (node_id, filename, content_type, size_bytes, data)
            VALUES (:node_id, :filename, :content_type, :size_bytes, :data)
            RETURNING id, node_id, filename, content_type, size_bytes, uploaded_at
        """),
        {
            "node_id":      str(node_id),
            "filename":     file.filename or "unnamed",
            "content_type": file.content_type or "application/octet-stream",
            "size_bytes":   len(data),
            "data":         data,
        },
    )
    await db.commit()
    return dict(row.mappings().first())


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT filename, content_type, data
            FROM twin.dim_node_attachment
            WHERE id = :id
        """),
        {"id": str(attachment_id)},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return Response(
        content=bytes(result["data"]),
        media_type=result["content_type"],
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
    )


@router.delete("/attachments/{attachment_id}", status_code=204)
async def delete_attachment(attachment_id: UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM twin.dim_node_attachment WHERE id = :id"),
        {"id": str(attachment_id)},
    )
    await db.commit()
