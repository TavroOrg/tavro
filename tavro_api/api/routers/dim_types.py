# =============================================================
# api/routers/dim_types.py
# =============================================================

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json

from api.database import get_db, AsyncSessionLocal, engine
from api.schemas import DimType, DimTypeCreate

router = APIRouter()

_SYSTEM_DIM_TYPES = [
    ("Profile",       "profile",      True,  1),
    ("Strategy",      "strategy",     True,  2),
    ("Process",       "process",      True,  2),
    ("Application",   "application",  True,  2),
    ("Integration",   "integration",  True,  2),
    ("Organisation",  "organisation", True,  2),
    ("Technology",    "technology",   True,  2),
    ("Risk",          "risk",         True,  3),
    ("Finance",       "finance",      True,  2),
    ("Custom",        "custom",       False, 2),
]

_VALID_CATEGORIES = {row[1] for row in _SYSTEM_DIM_TYPES}


async def seed_system_dim_types() -> None:
    """Ensure all system-defined dim_types exist. Safe to run on every startup."""
    # Skip silently if the twin schema hasn't been initialized yet (fresh DB).
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'twin'")
        )
        if not result.scalar():
            return

    # ALTER TYPE ADD VALUE must run outside a transaction (autocommit) for PG < 12 safety.
    # Parameterized queries are not supported for DDL enum values — values are hardcoded constants.
    async with engine.execution_options(isolation_level="AUTOCOMMIT").connect() as conn:
        for _, cat, _, _ in _SYSTEM_DIM_TYPES:
            await conn.execute(
                text(f"ALTER TYPE twin.dim_category ADD VALUE IF NOT EXISTS '{cat}'")
            )

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO twin.dim_type (name, category, system_defined, max_hops)
                VALUES (:name, :category, :system_defined, :max_hops)
                ON CONFLICT (name) DO NOTHING
            """),
            [
                {"name": name, "category": cat, "system_defined": sys_def, "max_hops": hops}
                for name, cat, sys_def, hops in _SYSTEM_DIM_TYPES
            ],
        )
        await db.commit()


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
    # Validate category against allowed ENUM values
    if body.category not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{body.category}'. Allowed categories: {', '.join(sorted(_VALID_CATEGORIES))}"
        )
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
            "value_schema": json.dumps(body.value_schema) if body.value_schema else None,
        },
    )
    await db.commit()
    return dict(row.mappings().first())
