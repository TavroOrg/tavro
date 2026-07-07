# =============================================================
# api/routers/user_context.py
# =============================================================

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.dependencies import require_tenant, require_user
from api.schemas import UserContext, UserContextUpdate

router = APIRouter()


@router.get("/context", response_model=UserContext)
async def get_user_context(user_id: str = Depends(require_user), db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM twin.user_preferences WHERE user_id = :uid"),
        {"uid": user_id},
    )
    result = row.mappings().first()
    if not result:
        return UserContext()
    return dict(result)


@router.patch("/context", response_model=UserContext)
async def update_user_context(
    body: UserContextUpdate,
    user_id: str = Depends(require_user),
    tenant_id: str = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    updates = {k: (str(v) if v is not None else v) for k, v in body.model_dump(exclude_unset=True).items()}

    await db.execute(
        text("INSERT INTO twin.user_preferences (user_id, tenant_id) VALUES (:uid, :tid) ON CONFLICT (user_id) DO NOTHING"),
        {"uid": user_id, "tid": tenant_id},
    )

    if updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        updates["uid"] = user_id
        await db.execute(
            text(f"UPDATE twin.user_preferences SET {set_clause} WHERE user_id = :uid"),
            updates,
        )

    await db.commit()

    row = await db.execute(
        text("SELECT * FROM twin.user_preferences WHERE user_id = :uid"),
        {"uid": user_id},
    )
    return dict(row.mappings().first())
