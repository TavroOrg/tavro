"""
Digital Twin — CSV ingestion for the Admin Portal.

Admins upload a single CSV file; each row becomes one chunk of text
("column: value" lines), which gets embedded and stored in
twin.enterprise_metadata so the AI assistant can later search over it.

Re-uploading a file (same tenant/company/file_name) replaces its
previously stored rows rather than appending or being rejected.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from api.database import AsyncSessionLocal
from api.dependencies.auth import require_portal_admin
from api.pipeline import chunker, embedder, parser, store

router = APIRouter()

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


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


@router.post("/digital-twin/process")
async def process_csv(  
    request: Request,
    file: UploadFile = File(...),
    auth: dict = Depends(require_portal_admin),
):
    tenant_id = _resolve_tenant_id(request)
    company_id = _resolve_company_id(request)

    file_name = (file.filename or "").strip()
    if not file_name.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    raw = await file.read()
    if len(raw) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB limit.")
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    async with AsyncSessionLocal() as db:
        try:
            df = parser.parse_csv(raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        chunks = chunker.build_chunks(df)
        if not chunks:
            raise HTTPException(status_code=422, detail="No usable rows were found in this CSV.")

        embeddings = await embedder.embed_texts([c["chunk_text"] for c in chunks])
        await store.upsert_chunks(db, tenant_id, company_id, file_name, chunks, embeddings)

    return {
        "file_name": file_name,
        "rows_processed": len(df),
        "chunks_embedded": len(chunks),
    }
