# =============================================================
# api/routers/dim_types.py
# =============================================================

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.schemas import DimType, DimTypeCreate

router = APIRouter()


@router.get("", response_model=list[DimType])
async def list_dim_types(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text("SELECT * FROM twin.dim_type ORDER BY category, name")
    )
    return [dict(r._mapping) for r in rows]


@router.get("/{dim_type_id}", response_model=DimType)
async def get_dim_type(dim_type_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM twin.dim_type WHERE id = :id"),
        {"id": str(dim_type_id)},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Dimension type not found")
    return dict(result)


@router.post("", response_model=DimType, status_code=201)
async def create_dim_type(body: DimTypeCreate, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("""
            INSERT INTO twin.dim_type
                (name, category, value_schema, system_defined, max_hops)
            VALUES
                (:name, :category, :value_schema, :system_defined, :max_hops)
            RETURNING *
        """),
        {
            **body.model_dump(),
            "value_schema": str(body.value_schema) if body.value_schema else None,
        },
    )
    await db.commit()
    return dict(row.mappings().first())
