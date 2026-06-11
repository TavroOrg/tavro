from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

ZITADEL_ISSUER = os.getenv("ZITADEL_ISSUER", "").rstrip("/")
# In Docker, ZITADEL is not at localhost — use the service name instead.
# Falls back to ZITADEL_ISSUER for local dev outside Docker.
_ZITADEL_INTERNAL_URL = os.getenv("ZITADEL_INTERNAL_URL", ZITADEL_ISSUER).rstrip("/")
_ZITADEL_INTERNAL_HOST = os.getenv("ZITADEL_INTERNAL_HOST", "")

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


def _extract_tenant_id(claims: dict[str, Any]) -> str | None:
    # ZITADEL v2+ may return resourceowner as a nested object: {"id": "...", "name": "..."}
    resource_owner = claims.get("urn:zitadel:iam:user:resourceowner")
    if isinstance(resource_owner, dict):
        ro_id = resource_owner.get("id")
        if isinstance(ro_id, str) and ro_id.strip():
            return ro_id.strip()

    for key in _TENANT_CLAIM_CANDIDATES:
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


async def require_portal_admin(request: Request) -> dict[str, Any]:
    """FastAPI dependency — validates the ZITADEL bearer token and enforces
    the portal_admin project role. Injects claims + tenant_id for the handler."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header[len("Bearer "):]

    if not ZITADEL_ISSUER:
        raise HTTPException(status_code=500, detail="ZITADEL_ISSUER is not configured.")

    request_headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
    if _ZITADEL_INTERNAL_HOST:
        request_headers["Host"] = _ZITADEL_INTERNAL_HOST

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{_ZITADEL_INTERNAL_URL}/oidc/v1/userinfo",
                headers=request_headers,
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach identity provider: {exc}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Identity provider returned {resp.status_code}.")

    claims: dict[str, Any] = resp.json()
    import json as _json
    print(f"[admin auth] userinfo response: {_json.dumps(claims, indent=2)}", flush=True)

    roles: dict[str, Any] = claims.get("urn:zitadel:iam:org:project:roles", {})
    if "portal_admin" not in roles:
        raise HTTPException(status_code=403, detail="Insufficient privileges. The portal_admin role is required.")

    return {
        "claims": claims,
        "tenant_id": _extract_tenant_id(claims),
    }
