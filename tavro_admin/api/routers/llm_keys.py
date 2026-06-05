"""LLM provider key CRUD — stores keys encrypted, never returns raw key values."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api import crypto

router = APIRouter()


class LLMKeyCreate(BaseModel):
    name: str
    provider: str   # github_copilot | openai | azure_openai | anthropic
    model: str
    api_key: str
    azure_endpoint: Optional[str] = None
    azure_api_version: Optional[str] = None


class LLMKeyUpdate(BaseModel):
    model: Optional[str] = None
    api_key: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_version: Optional[str] = None


class LLMKeyOut(BaseModel):
    id: str
    name: str
    provider: str
    model: str
    azure_endpoint: Optional[str]
    azure_api_version: Optional[str]
    created_at: str
    updated_at: str


def _row_out(row: dict) -> LLMKeyOut:
    return LLMKeyOut(
        id=str(row["id"]),
        name=row["name"],
        provider=row["provider"],
        model=row["model"],
        azure_endpoint=row.get("azure_endpoint"),
        azure_api_version=row.get("azure_api_version"),
        created_at=row["created_at"].isoformat() if row.get("created_at") else "",
        updated_at=row["updated_at"].isoformat() if row.get("updated_at") else "",
    )


@router.get("/llm-keys", response_model=list[LLMKeyOut])
async def list_llm_keys():
    async with AsyncSessionLocal() as db:
        rows = await db.execute(text("""
            SELECT id, name, provider, model, azure_endpoint, azure_api_version,
                   created_at, updated_at
            FROM admin.llm_keys
            ORDER BY created_at ASC
        """))
        return [_row_out(dict(r)) for r in rows.mappings()]


@router.post("/llm-keys", response_model=LLMKeyOut)
async def create_llm_key(body: LLMKeyCreate):
    if body.provider not in ("github_copilot", "openai", "azure_openai", "anthropic"):
        raise HTTPException(status_code=422, detail=f"Unsupported provider: {body.provider}")
    if not body.api_key.strip():
        raise HTTPException(status_code=422, detail="api_key is required")

    enc = crypto.encrypt(body.api_key.strip())
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(text("""
                INSERT INTO admin.llm_keys
                    (name, provider, model, api_key_enc, azure_endpoint, azure_api_version)
                VALUES
                    (:name, :provider, :model, :enc, :ep, :ver)
                RETURNING id, name, provider, model, azure_endpoint, azure_api_version,
                          created_at, updated_at
            """), {
                "name": body.name, "provider": body.provider,
                "model": body.model, "enc": enc,
                "ep": body.azure_endpoint, "ver": body.azure_api_version,
            })
            await db.commit()
            return _row_out(dict(result.mappings().one()))
        except Exception as exc:
            await db.rollback()
            raise HTTPException(status_code=400, detail=str(exc))


@router.put("/llm-keys/{key_id}", response_model=LLMKeyOut)
async def update_llm_key(key_id: str, body: LLMKeyUpdate):
    sets = ["updated_at = now()"]
    params: dict = {"id": key_id}

    if body.model is not None:
        sets.append("model = :model"); params["model"] = body.model
    if body.api_key and body.api_key.strip():
        sets.append("api_key_enc = :enc"); params["enc"] = crypto.encrypt(body.api_key.strip())
    if body.azure_endpoint is not None:
        sets.append("azure_endpoint = :ep"); params["ep"] = body.azure_endpoint
    if body.azure_api_version is not None:
        sets.append("azure_api_version = :ver"); params["ver"] = body.azure_api_version

    async with AsyncSessionLocal() as db:
        result = await db.execute(text(f"""
            UPDATE admin.llm_keys SET {', '.join(sets)}
            WHERE id = CAST(:id AS UUID)
            RETURNING id, name, provider, model, azure_endpoint, azure_api_version,
                      created_at, updated_at
        """), params)
        row = result.mappings().one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="LLM key not found")
        await db.commit()
        return _row_out(dict(row))


@router.delete("/llm-keys/{key_id}", status_code=204)
async def delete_llm_key(key_id: str):
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("DELETE FROM admin.llm_keys WHERE id = CAST(:id AS UUID)"),
            {"id": key_id},
        )
        await db.commit()
