# =============================================================
# api/routers/dim_nodes.py
# =============================================================

from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json

from api.database import get_db
from api.dependencies import require_tenant
from api.schemas import DimNode, DimNodeCreate, DimNodeUpdate, AttachmentOut
from api.routers.business_relations import (
    sync_dim_node_to_business_entity,
    _ensure_application_attachments_table,
    _ensure_process_attachments_table,
    _ensure_integration_attachments_table,
    _ENTITY_COL_MAP,
)

router = APIRouter()


async def _assert_company_owned(db: AsyncSession, company_id: str, tenant_id: str) -> None:
    """Raise 404 if the company does not exist or belongs to a different tenant."""
    row = await db.execute(
        text("SELECT 1 FROM twin.company WHERE id = :cid AND (tenant_id = :tid OR tenant_id IS NULL)"),
        {"cid": company_id, "tid": tenant_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Company not found")


async def _assert_node_owned(db: AsyncSession, node_id: str, tenant_id: str) -> None:
    """Raise 404 if the node does not exist or its company belongs to a different tenant."""
    row = await db.execute(
        text("""
            SELECT 1 FROM twin.dim_node n
            JOIN twin.company c ON c.id = n.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE n.id = :nid AND n.valid_to IS NULL
        """),
        {"nid": node_id, "tid": tenant_id},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Node not found")


@router.get("")
async def list_dim_nodes(
    company_id:  UUID,
    tenant_id: str = Depends(require_tenant),
    dim_type_id: Optional[UUID]  = None,
    category:    Optional[str]   = None,
    search:      Optional[str]   = None,
    active_only: bool            = True,
    start_record: int            = 1,
    record_range: str            = "1-100",
    db: AsyncSession = Depends(get_db),
):
    try:
        parts = record_range.split("-")
        start, end = int(parts[0]), int(parts[1])
    except Exception:
        start, end = start_record, start_record + 99

    await _assert_company_owned(db, str(company_id), tenant_id)

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

    rows = await db.execute(
        text(f"""
            SELECT * FROM (
                SELECT n.*,
                       t.name     AS dim_type_name,
                       t.category AS category,
                       ROW_NUMBER() OVER (ORDER BY t.category, n.label) AS rn,
                       COUNT(*) OVER () AS total_records
                FROM twin.dim_node n
                JOIN twin.dim_type t ON t.id = n.dim_type_id
                WHERE {where}
            ) windowed
            WHERE rn BETWEEN :window_start AND :window_end
            ORDER BY rn
        """),
        {**params, "window_start": start, "window_end": end},
    )
    raw_rows = [dict(r._mapping) for r in rows]
    total = int(raw_rows[0]["total_records"]) if raw_rows else 0
    items = [{k: v for k, v in r.items() if k not in ("rn", "total_records")} for r in raw_rows]
    return {"start_record": start, "end_record": end, "record_count": len(items),
            "total_records": total, "data": items}


@router.get("/{node_id}", response_model=DimNode)
async def get_dim_node(node_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            SELECT n.*,
                   t.name     AS dim_type_name,
                   t.category AS category
            FROM twin.dim_node n
            JOIN twin.dim_type t ON t.id = n.dim_type_id
            JOIN twin.company c ON c.id = n.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE n.id = :id
              AND n.valid_to IS NULL
        """),
        {"id": str(node_id), "tid": tenant_id},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return dict(result)


@router.post("", response_model=DimNode, status_code=201)
async def create_dim_node(body: DimNodeCreate, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    await _assert_company_owned(db, str(body.company_id), tenant_id)

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
                body.tags,
                tenant_id,
                node_id=node["id"],
                sensitive=body.sensitive,
                visibility=body.visibility,
            )
    except Exception:
        pass  # Non-fatal — dim_node was already committed

    return node


@router.patch("/{node_id}", response_model=DimNode)
async def update_dim_node(
    node_id: UUID,
    body: DimNodeUpdate,
    tenant_id: str = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    await _assert_node_owned(db, str(node_id), tenant_id)

    # Capture the pre-update category and entity FK columns so we can detect a category change.
    prev_row = await db.execute(
        text("""
            SELECT t.category, n.company_id, n.business_application_id, n.business_process_id, n.integration_id
            FROM twin.dim_type t
            JOIN twin.dim_node n ON n.dim_type_id = t.id
            WHERE n.id = :id
        """),
        {"id": str(node_id)},
    )
    prev = prev_row.mappings().first()
    old_category = prev["category"] if prev else None

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

    # Sync changes back to the linked business entity (non-fatal)
    try:
        cat_r = await db.execute(
            text("""
                SELECT t.category
                FROM twin.dim_type t
                JOIN twin.dim_node n ON n.dim_type_id = t.id
                WHERE n.id = :id
            """),
            {"id": str(node_id)},
        )
        cat_row = cat_r.mappings().first()
        if cat_row:
            new_category = cat_row["category"]
            node_data = dict(result)
            new_label = node_data.get("label")
            new_summary = str(node_data.get("summary") or "") or None
            raw_tags = node_data.get("tags") or []
            raw_sensitive = node_data.get("sensitive")
            raw_visibility = node_data.get("visibility")
            tags_json = json.dumps(raw_tags if isinstance(raw_tags, list) else [])

            if prev and old_category != new_category:
                # Category changed: detach from the old category's entity table so the
                # node stops appearing (and can no longer be deleted) via the stale catalog.
                old_entity_col = _ENTITY_COL_MAP.get(old_category)
                if old_entity_col:
                    old_entity_id = prev.get(old_entity_col)
                    if old_entity_id:
                        await db.execute(
                            text(f"UPDATE twin.dim_node SET {old_entity_col} = NULL WHERE id = :id"),
                            {"id": str(node_id)},
                        )
                        old_table = {
                            "business_application_id": ("core.business_applications", "business_application_id"),
                            "business_process_id":     ("core.business_processes", "business_process_id"),
                            "integration_id":           ("core.business_integrations", "integration_id"),
                        }[old_entity_col]
                        await db.execute(
                            text(f"DELETE FROM {old_table[0]} WHERE {old_table[1]} = :eid"),
                            {"eid": old_entity_id},
                        )
                        await db.commit()

                # Link/create the entity record for the new category, if applicable.
                if new_category in ("application", "process", "integration"):
                    company_id = node_data.get("company_id") or (prev.get("company_id") if prev else None)
                    company_name = None
                    if company_id:
                        company_row = await db.execute(
                            text("SELECT name FROM twin.company WHERE id = :id LIMIT 1"),
                            {"id": str(company_id)},
                        )
                        company = company_row.mappings().first()
                        company_name = company["name"] if company else None
                    await sync_dim_node_to_business_entity(
                        db,
                        str(company_id),
                        company_name,
                        new_category,
                        new_label,
                        new_summary,
                        raw_tags if isinstance(raw_tags, list) else [],
                        tenant_id,
                        node_id=str(node_id),
                        sensitive=raw_sensitive,
                        visibility=raw_visibility,
                    )
            elif new_category == "application":
                entity_id = prev.get("business_application_id") if prev else None
                if entity_id:
                    await db.execute(
                        text("""
                            UPDATE core.business_applications
                            SET application_name        = :name,
                                application_description = :desc,
                                tags                    = cast(:tags as jsonb),
                                sensitive               = coalesce(:sensitive, sensitive),
                                visibility              = coalesce(:visibility, visibility),
                                updated_ts              = CURRENT_TIMESTAMP
                            WHERE business_application_id = :eid
                        """),
                        {"name": new_label, "desc": new_summary, "tags": tags_json, "sensitive": raw_sensitive, "visibility": raw_visibility, "eid": entity_id},
                    )
                await db.commit()
            elif new_category == "process":
                entity_id = prev.get("business_process_id") if prev else None
                if entity_id:
                    await db.execute(
                        text("""
                            UPDATE core.business_processes
                            SET process_name        = :name,
                                process_description = :desc,
                                tags                = cast(:tags as jsonb),
                                sensitive           = coalesce(:sensitive, sensitive),
                                visibility          = coalesce(:visibility, visibility),
                                updated_ts          = CURRENT_TIMESTAMP
                            WHERE business_process_id = :eid
                        """),
                        {"name": new_label, "desc": new_summary, "tags": tags_json, "sensitive": raw_sensitive, "visibility": raw_visibility, "eid": entity_id},
                    )
                await db.commit()
            elif new_category == "integration":
                entity_id = prev.get("integration_id") if prev else None
                if entity_id:
                    await db.execute(
                        text("""
                            UPDATE core.business_integrations
                            SET integration_name        = :name,
                                integration_description = :desc,
                                tags                    = cast(:tags as jsonb),
                                sensitive               = coalesce(:sensitive, sensitive),
                                visibility              = coalesce(:visibility, visibility),
                                updated_ts              = CURRENT_TIMESTAMP
                            WHERE integration_id = :eid
                        """),
                        {"name": new_label, "desc": new_summary, "tags": tags_json, "sensitive": raw_sensitive, "visibility": raw_visibility, "eid": entity_id},
                    )
                await db.commit()
    except Exception:
        pass

    return dict(result)


@router.delete("/{node_id}", status_code=204)
async def soft_delete_dim_node(node_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    """Soft delete — sets valid_to = now() rather than deleting the row, then hard-deletes the linked entity."""
    await _assert_node_owned(db, str(node_id), tenant_id)

    # Read entity FK columns before soft-deleting so we can cascade to the entity table.
    entity_data = None
    try:
        entity_row = await db.execute(
            text("""
                SELECT dn.business_application_id, dn.business_process_id, dn.integration_id
                FROM twin.dim_node dn
                WHERE dn.id = :id AND dn.valid_to IS NULL
            """),
            {"id": str(node_id)},
        )
        entity_data = entity_row.mappings().first()
    except Exception:
        await db.rollback()

    result = await db.execute(
        text("UPDATE twin.dim_node SET valid_to = now() WHERE id = :id AND valid_to IS NULL"),
        {"id": str(node_id)},
    )
    if result.rowcount == 0:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Node not found or already deleted")

    # Soft-delete all edges involving this node so they no longer appear in Blueprint Relationships
    try:
        await db.execute(
            text("""
                UPDATE twin.dim_edge
                SET valid_to = now()
                WHERE (source_id = :id OR target_id = :id) AND valid_to IS NULL
            """),
            {"id": str(node_id)},
        )
    except Exception:
        pass  # Non-fatal

    # Cascade hard-delete to the linked business entity (non-fatal)
    try:
        if entity_data:
            if entity_data.get("business_application_id"):
                await db.execute(
                    text("DELETE FROM core.business_applications WHERE business_application_id = :eid"),
                    {"eid": entity_data["business_application_id"]},
                )
            elif entity_data.get("business_process_id"):
                await db.execute(
                    text("DELETE FROM core.business_processes WHERE business_process_id = :eid"),
                    {"eid": entity_data["business_process_id"]},
                )
            elif entity_data.get("integration_id"):
                await db.execute(
                    text("DELETE FROM core.business_integrations WHERE integration_id = :eid"),
                    {"eid": entity_data["integration_id"]},
                )
    except Exception:
        pass  # Entity delete is best-effort; dim_node soft-delete is already done

    await db.commit()


# ── Linked Business Entity ────────────────────────────────────────────────────

@router.get("/{node_id}/linked-entity")
async def get_linked_entity(
    node_id: UUID,
    tenant_id: str = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Return the business entity (application/process/integration) linked to this dim_node."""
    await _assert_node_owned(db, str(node_id), tenant_id)

    # Primary: read entity_id columns directly from the dim_node row
    try:
        node_row = await db.execute(
            text("""
                SELECT label, company_id,
                       business_application_id, business_process_id, integration_id
                FROM twin.dim_node WHERE id = :id
            """),
            {"id": str(node_id)},
        )
        node = node_row.mappings().first()
    except Exception:
        node = None
        try:
            await db.rollback()
        except Exception:
            pass

    if node:
        if node.get("business_application_id"):
            return {"entity_type": "application", "entity_id": node["business_application_id"]}
        if node.get("business_process_id"):
            return {"entity_type": "process", "entity_id": node["business_process_id"]}
        if node.get("integration_id"):
            return {"entity_type": "integration", "entity_id": node["integration_id"]}

    # Final fallback: name + company_id match
    if node:
        for tbl, pk, etype in [
            ("core.business_applications", "business_application_id", "application"),
            ("core.business_processes", "business_process_id", "process"),
            ("core.business_integrations", "integration_id", "integration"),
        ]:
            name_col = "application_name" if etype == "application" else ("process_name" if etype == "process" else "integration_name")
            try:
                fb = await db.execute(
                    text(f"SELECT {pk} FROM {tbl} WHERE LOWER({name_col}) = LOWER(:name) AND company_id = :cid LIMIT 1"),
                    {"name": node["label"], "cid": str(node["company_id"])},
                )
                fb_result = fb.mappings().first()
                if fb_result:
                    return {"entity_type": etype, "entity_id": fb_result[pk]}
            except Exception:
                pass

    raise HTTPException(status_code=404, detail="No linked business entity found for this node")


# ── Attachments ──────────────────────────────────────────────────────────────

@router.get("/{node_id}/attachments", response_model=List[AttachmentOut])
async def list_attachments(node_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):
    await _assert_node_owned(db, str(node_id), tenant_id)

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
    tenant_id: str = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    await _assert_node_owned(db, str(node_id), tenant_id)

    data = await file.read()
    fname = file.filename or "unnamed"

    dup = await db.execute(
        text("SELECT 1 FROM twin.dim_node_attachment WHERE node_id = :nid AND filename = :fn LIMIT 1"),
        {"nid": str(node_id), "fn": fname},
    )
    if dup.scalar():
        raise HTTPException(status_code=409, detail=f"A file named '{fname}' already exists for this dimension.")

    row = await db.execute(
        text("""
            INSERT INTO twin.dim_node_attachment (node_id, filename, content_type, size_bytes, data)
            VALUES (:node_id, :filename, :content_type, :size_bytes, :data)
            RETURNING id, node_id, filename, content_type, size_bytes, uploaded_at
        """),
        {
            "node_id":      str(node_id),
            "filename":     fname,
            "content_type": file.content_type or "application/octet-stream",
            "size_bytes":   len(data),
            "data":         data,
        },
    )
    await db.commit()
    attachment_record = dict(row.mappings().first())

    mime = file.content_type or "application/octet-stream"

    # Read entity_id columns from dim_node — the node is the FK holder
    try:
        eid_row = await db.execute(
            text("SELECT business_application_id, business_process_id, integration_id FROM twin.dim_node WHERE id = :nid"),
            {"nid": str(node_id)},
        )
        eid = eid_row.mappings().first()
    except Exception:
        eid = None

    # Sync to application_attachment (non-fatal)
    try:
        await _ensure_application_attachments_table(db)
        app_id = str(eid["business_application_id"]) if eid and eid.get("business_application_id") else None
        if app_id:
            dup = await db.execute(
                text("SELECT 1 FROM public.application_attachment WHERE application_id = :aid AND filename = :fn LIMIT 1"),
                {"aid": app_id, "fn": fname},
            )
            if not dup.scalar():
                await db.execute(
                    text("""
                        INSERT INTO public.application_attachment
                            (application_id, filename, mime_type, file_size_bytes, file_data)
                        VALUES (:application_id, :filename, :mime_type, :file_size_bytes, :file_data)
                    """),
                    {"application_id": app_id, "filename": fname, "mime_type": mime, "file_size_bytes": len(data), "file_data": data},
                )
                await db.commit()
    except Exception:
        pass

    # Sync to process_attachment (non-fatal)
    try:
        await _ensure_process_attachments_table(db)
        pid = str(eid["business_process_id"]) if eid and eid.get("business_process_id") else None
        if pid:
            dup = await db.execute(
                text("SELECT 1 FROM public.process_attachment WHERE process_id = :pid AND filename = :fn LIMIT 1"),
                {"pid": pid, "fn": fname},
            )
            if not dup.scalar():
                await db.execute(
                    text("""
                        INSERT INTO public.process_attachment
                            (process_id, filename, mime_type, file_size_bytes, file_data)
                        VALUES (:process_id, :filename, :mime_type, :file_size_bytes, :file_data)
                    """),
                    {"process_id": pid, "filename": fname, "mime_type": mime, "file_size_bytes": len(data), "file_data": data},
                )
                await db.commit()
    except Exception:
        pass

    # Sync to integration_attachment (non-fatal)
    try:
        await _ensure_integration_attachments_table(db)
        iid = str(eid["integration_id"]) if eid and eid.get("integration_id") else None
        if iid:
            dup = await db.execute(
                text("SELECT 1 FROM public.integration_attachment WHERE integration_id = :iid AND filename = :fn LIMIT 1"),
                {"iid": iid, "fn": fname},
            )
            if not dup.scalar():
                await db.execute(
                    text("""
                        INSERT INTO public.integration_attachment
                            (integration_id, filename, mime_type, file_size_bytes, file_data)
                        VALUES (:integration_id, :filename, :mime_type, :file_size_bytes, :file_data)
                    """),
                    {"integration_id": iid, "filename": fname, "mime_type": mime, "file_size_bytes": len(data), "file_data": data},
                )
                await db.commit()
    except Exception:
        pass

    return attachment_record


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    row = await db.execute(
        text("""
            SELECT a.filename, a.content_type, a.data
            FROM twin.dim_node_attachment a
            JOIN twin.dim_node n ON n.id = a.node_id
            JOIN twin.company c ON c.id = n.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE a.id = :id
        """),
        {"id": str(attachment_id), "tid": tenant_id},
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
async def delete_attachment(attachment_id: UUID, tenant_id: str = Depends(require_tenant), db: AsyncSession = Depends(get_db)):

    # Validate ownership and fetch metadata before deleting
    check = await db.execute(
        text("""
            SELECT a.id, a.filename, n.id AS node_id FROM twin.dim_node_attachment a
            JOIN twin.dim_node n ON n.id = a.node_id
            JOIN twin.company c ON c.id = n.company_id AND (c.tenant_id = :tid OR c.tenant_id IS NULL)
            WHERE a.id = :id
        """),
        {"id": str(attachment_id), "tid": tenant_id},
    )
    att_row = check.mappings().first()
    if not att_row:
        raise HTTPException(status_code=404, detail="Attachment not found")

    await db.execute(
        text("DELETE FROM twin.dim_node_attachment WHERE id = :id"),
        {"id": str(attachment_id)},
    )
    await db.commit()

    node_id_str = str(att_row["node_id"])
    fname = att_row["filename"]

    # Read entity_id columns from dim_node — the node is the FK holder
    try:
        eid_row = await db.execute(
            text("SELECT business_application_id, business_process_id, integration_id FROM twin.dim_node WHERE id = :nid"),
            {"nid": node_id_str},
        )
        eid = eid_row.mappings().first()
    except Exception:
        eid = None

    # Also remove from application_attachment by filename (non-fatal)
    try:
        await _ensure_application_attachments_table(db)
        app_id = str(eid["business_application_id"]) if eid and eid.get("business_application_id") else None
        if app_id:
            await db.execute(
                text("DELETE FROM public.application_attachment WHERE application_id = :aid AND filename = :fn"),
                {"aid": app_id, "fn": fname},
            )
            await db.commit()
    except Exception:
        pass

    # Also remove from process_attachment by filename (non-fatal)
    try:
        await _ensure_process_attachments_table(db)
        pid = str(eid["business_process_id"]) if eid and eid.get("business_process_id") else None
        if pid:
            await db.execute(
                text("DELETE FROM public.process_attachment WHERE process_id = :pid AND filename = :fn"),
                {"pid": pid, "fn": fname},
            )
            await db.commit()
    except Exception:
        pass

    # Also remove from integration_attachment by filename (non-fatal)
    try:
        await _ensure_integration_attachments_table(db)
        iid = str(eid["integration_id"]) if eid and eid.get("integration_id") else None
        if iid:
            await db.execute(
                text("DELETE FROM public.integration_attachment WHERE integration_id = :iid AND filename = :fn"),
                {"iid": iid, "fn": fname},
            )
            await db.commit()
    except Exception:
        pass