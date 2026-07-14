# =============================================================
# api/routers/enterprise_metadata.py
# Read-only listing over twin.enterprise_metadata (admin-uploaded Digital
# Twin CSV rows). Unauthenticated and unscoped by design — no parameters,
# returns every row across all tenants/companies.
# =============================================================

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()


@router.get("/")
async def list_enterprise_metadata(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text("""
            SELECT
                id,
                metadata_type,
                source_system,
                namespace,
                label,
                description,
                chunk_text,
                structured_metadata,
                is_sensitive,
                tags,
                company_id,
                created_at
            FROM twin.enterprise_metadata
            ORDER BY created_at DESC
        """)
    )
    results = [dict(r._mapping) for r in rows]

    return {"count": len(results), "results": results}
