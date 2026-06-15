from __future__ import annotations

import json as _json
import os
from pathlib import Path as _Path
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer_scheme = HTTPBearer(auto_error=False)

_TENANT_CLAIM_CANDIDATES = (
    "urn:zitadel:iam:user:resourceowner:id",
    "urn:zitadel:iam:org:id",
    "urn:zitadel:iam:org:org_id",
    "org_id",
    "orgId",
    "org",
    "tenant_id",
    "tenant",
)


def _load_runtime_config() -> dict[str, Any]:
    for path in [
        "/app/static/runtime/tavro-runtime-config.json",
        "/app/runtime/tavro-runtime-config.json",
        "/runtime/tavro-runtime-config.json",
    ]:
        try:
            return _json.loads(_Path(path).read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _zitadel_issuer() -> str:
    rt = _load_runtime_config()
    return (
        rt.get("zitadelIssuer")
        or os.getenv("ZITADEL_ISSUER")
        or os.getenv("VITE_ZITADEL_ISSUER")
        or ""
    ).rstrip("/")


def _zitadel_internal_url() -> str:
    return (
        os.getenv("ZITADEL_INTERNAL_URL")
        or _zitadel_issuer()
        or "http://zitadel-api:8080"
    ).rstrip("/")


def _zitadel_internal_host() -> str:
    return os.getenv("ZITADEL_INTERNAL_HOST", "")


def _extract_tenant_id(claims: dict[str, Any]) -> str | None:
    resource_owner = claims.get("urn:zitadel:iam:user:resourceowner")
    if isinstance(resource_owner, dict):
        ro_id = resource_owner.get("id")
        if isinstance(ro_id, str) and ro_id.strip():
            return ro_id.strip()

    for key in _TENANT_CLAIM_CANDIDATES:
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    # Last resort: use the user's own subject ID so auth never hard-blocks
    sub = claims.get("sub")
    return sub if isinstance(sub, str) and sub.strip() else None


async def require_authenticated_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict[str, Any]:
    """FastAPI dependency — validates the Zitadel bearer token for any authenticated user.
    Injects claims + tenant_id for the handler."""
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="You are not authenticated. Please log in via the Authorize button in Swagger UI or include a valid Bearer token in the Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    issuer = _zitadel_issuer()
    if not issuer:
        raise HTTPException(status_code=500, detail="ZITADEL_ISSUER is not configured.")

    internal_url = _zitadel_internal_url()
    internal_host = _zitadel_internal_host()

    request_headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
    if internal_host:
        request_headers["Host"] = internal_host

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{internal_url}/oidc/v1/userinfo",
                headers=request_headers,
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach identity provider: {exc}")

    if resp.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="Your session has expired or the token is invalid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Identity provider returned {resp.status_code}.")

    claims: dict[str, Any] = resp.json()

    result = {
        "claims": claims,
        "tenant_id": _extract_tenant_id(claims),
    }
    request.state.auth = result
    return result
