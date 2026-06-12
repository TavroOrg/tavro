from __future__ import annotations

import os
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

AGENT_LIBRARY = os.getenv("AGENT_LIBRARY_DB_NAME", "agent_library")


def _tenant(request: Request) -> Optional[str]:
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


class AgentLibraryItem(BaseModel):
    agent_name: Optional[str]
    summary: Optional[str]
    industry: Optional[str]


class AgentLibraryResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_pages: int
    data: List[AgentLibraryItem]


@router.get("/", response_model=AgentLibraryResponse)
async def get_agent_library(
    request: Request,
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(10, ge=1, le=100, description="Records per page"),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _tenant(request)
    offset = (page - 1) * page_size

    if tenant_id:
        where = "WHERE tenant_id = :tenant_id"
        params = {"tenant_id": tenant_id, "limit": page_size, "offset": offset}
        count_params = {"tenant_id": tenant_id}
    else:
        where = ""
        params = {"limit": page_size, "offset": offset}
        count_params = {}

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM {AGENT_LIBRARY}.catalog {where}"),
        count_params,
    )
    total = count_result.scalar() or 0

    rows_result = await db.execute(
        text(f"""
            SELECT agent_name, summary, industry
            FROM {AGENT_LIBRARY}.catalog
            {where}
            ORDER BY agent_name
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = rows_result.mappings().all()

    total_pages = max(1, (total + page_size - 1) // page_size)

    return AgentLibraryResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        data=[AgentLibraryItem(**dict(r)) for r in rows],
    )
