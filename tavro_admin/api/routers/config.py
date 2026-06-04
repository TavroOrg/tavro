"""Admin key-value config endpoints (MCP URL, API keys, Zitadel config, etc.)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api import crypto

router = APIRouter()


class ConfigEntry(BaseModel):
    key: str
    value: Optional[str]
    encrypted: bool
    description: Optional[str]


class ConfigUpdate(BaseModel):
    value: Optional[str]


@router.get("/config", response_model=list[ConfigEntry])
async def get_admin_config():
    """Returns all config entries. Encrypted values are masked."""
    async with AsyncSessionLocal() as db:
        rows = await db.execute(text("""
            SELECT key, value_enc, encrypted, description
            FROM admin.config
            ORDER BY key
        """))
        result = []
        for r in rows.mappings():
            raw = r["value_enc"]
            is_enc = bool(r["encrypted"])
            display = "••••••••" if (is_enc and raw) else raw
            result.append(ConfigEntry(
                key=r["key"],
                value=display,
                encrypted=is_enc,
                description=r["description"],
            ))
        return result


@router.get("/config/{config_key}", response_model=ConfigEntry)
async def get_config_entry(config_key: str):
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT key, value_enc, encrypted, description FROM admin.config WHERE key = :k"),
            {"k": config_key},
        )).mappings().one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Config key '{config_key}' not found")
        raw = row["value_enc"]
        is_enc = bool(row["encrypted"])
        display = "••••••••" if (is_enc and raw) else raw
        return ConfigEntry(key=row["key"], value=display, encrypted=is_enc, description=row["description"])


@router.put("/config/{config_key}", response_model=ConfigEntry)
async def update_config_entry(config_key: str, body: ConfigUpdate):
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT key, encrypted FROM admin.config WHERE key = :k"),
            {"k": config_key},
        )).mappings().one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Config key '{config_key}' not found")

        is_enc = bool(row["encrypted"])
        store_value: Optional[str] = None
        if body.value is not None and body.value.strip():
            store_value = crypto.encrypt(body.value.strip()) if is_enc else body.value.strip()

        await db.execute(text("""
            UPDATE admin.config SET value_enc = :val, updated_at = now() WHERE key = :k
        """), {"val": store_value, "k": config_key})
        await db.commit()

        display = "••••••••" if (is_enc and store_value) else store_value
        return ConfigEntry(key=config_key, value=display, encrypted=is_enc, description=None)
