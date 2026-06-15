from __future__ import annotations

import base64
import hashlib
import json as _json
import os
import secrets
from pathlib import Path as _Path
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, Form, HTTPException

router = APIRouter()


def _load_runtime_config() -> dict:
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


def _internal_url() -> str:
    """Resolve Zitadel's internal URL at request time — never at import time."""
    return (
        os.getenv("ZITADEL_INTERNAL_URL")
        or os.getenv("ZITADEL_ISSUER")
        or os.getenv("VITE_ZITADEL_ISSUER")
        # Known Docker service name — works even when env vars aren't passed
        or "http://zitadel-api:8080"
    ).rstrip("/")


def _login_client_pat() -> str:
    """Read the Zitadel login-client PAT needed to authenticate session creation."""
    for path in [
        "/app/zitadel-bootstrap/login-client.pat",
        "/app/zitadel-bootstrap/admin.pat",
    ]:
        try:
            return _Path(path).read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""


def _default_client_id() -> str:
    rt = _load_runtime_config()
    return (
        rt.get("zitadelClientId")
        or os.getenv("VITE_ZITADEL_CLIENT_ID")
        or os.getenv("ZITADEL_CLIENT_ID")
        or ""
    )


def _internal_host() -> str:
    # Zitadel needs the external Host header to route requests correctly even
    # when called via its internal Docker network address.
    return (
        os.getenv("ZITADEL_INTERNAL_HOST")
        or f"{os.getenv('ZITADEL_DOMAIN', 'localhost')}:{os.getenv('ZITADEL_EXTERNALPORT', '8080')}"
    )


def _redirect_uri() -> str:
    origin = os.getenv("TAVRO_PUBLIC_ORIGIN", "http://localhost:9000")
    return f"{origin}/auth/callback"


def _base_headers() -> dict[str, str]:
    host = _internal_host()
    return {"Host": host} if host else {}


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE S256."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


@router.post(
    "/token",
    summary="Get access token",
    description=(
        "Exchange Zitadel username and password for an access token. "
        "Performs the full OIDC authorization code flow server-side — no browser redirect needed."
    ),
    response_description="OAuth2 token response from Zitadel",
)
async def get_token(
    username: str = Form(),
    password: str = Form(),
    client_id: str = Form(default=""),
    scope: str = Form(default="openid profile email urn:zitadel:iam:user:resourceowner"),
    grant_type: str = Form(default="password"),
) -> dict:
    internal = _internal_url()
    redirect = _redirect_uri()

    if not client_id:
        client_id = _default_client_id()
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required — set VITE_ZITADEL_CLIENT_ID or mount the runtime config volume.")

    headers = _base_headers()
    code_verifier, code_challenge = _pkce_pair()

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as http:

        # ── Step 1: Start OIDC flow, extract authRequestID from redirect ──────
        authorize_resp = await http.get(
            f"{internal}/oauth/v2/authorize",
            params={
                "client_id": client_id,
                "redirect_uri": redirect,
                "response_type": "code",
                "scope": scope,
                "state": "tavro-swagger",
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            },
            headers=headers,
        )

        location = authorize_resp.headers.get("location", "")
        qs = parse_qs(urlparse(location).query)
        auth_request_id = (qs.get("authRequestID") or qs.get("authRequest") or [None])[0]

        if not auth_request_id:
            raise HTTPException(
                status_code=502,
                detail={
                    "msg": "Could not get authRequestID from Zitadel",
                    "status": authorize_resp.status_code,
                    "location": location or None,
                    "body": authorize_resp.text[:500],
                    "internal_url": internal,
                    "host_header": headers.get("Host"),
                    "redirect_uri": redirect,
                },
            )

        # ── Step 2: Create Zitadel session with user credentials ──────────────
        login_pat = _login_client_pat()
        session_headers = {**headers, "Content-Type": "application/json"}
        if login_pat:
            session_headers["Authorization"] = f"Bearer {login_pat}"
        session_resp = await http.post(
            f"{internal}/v2/sessions",
            json={
                "checks": {
                    "user": {"loginName": username},
                    "password": {"password": password},
                }
            },
            headers=session_headers,
        )

        if session_resp.status_code in (400, 401, 403):
            raise HTTPException(
                status_code=401,
                detail={
                    "msg": "Invalid username or password.",
                    "zitadel_status": session_resp.status_code,
                    "zitadel_response": session_resp.text[:500],
                },
            )
        if not session_resp.is_success:
            raise HTTPException(status_code=502, detail=f"Session creation failed: {session_resp.text}")

        session = session_resp.json()
        session_id = session.get("sessionId")
        session_token = session.get("sessionToken")

        if not session_id or not session_token:
            raise HTTPException(status_code=502, detail=f"Unexpected session response: {session}")

        # ── Step 3: Finalize auth request with session → get code ─────────────
        finalize_headers = {**session_headers, "Content-Type": "application/json"}
        finalize_resp = await http.post(
            f"{internal}/v2/oidc/auth_requests/{auth_request_id}",
            json={"session": {"sessionId": session_id, "sessionToken": session_token}},
            headers=finalize_headers,
        )

        if not finalize_resp.is_success:
            raise HTTPException(
                status_code=502, detail=f"Auth request finalization failed: {finalize_resp.text}"
            )

        callback_url = finalize_resp.json().get("callbackUrl", "")
        code = parse_qs(urlparse(callback_url).query).get("code", [None])[0]

        if not code:
            raise HTTPException(
                status_code=502, detail=f"No authorization code in callback URL: {callback_url}"
            )

        # ── Step 4: Exchange code for access token ────────────────────────────
        token_resp = await http.post(
            f"{internal}/oauth/v2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect,
                "client_id": client_id,
                "code_verifier": code_verifier,
            },
            headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
        )

        if not token_resp.is_success:
            raise HTTPException(
                status_code=502, detail=f"Token exchange failed: {token_resp.text}"
            )

        return token_resp.json()
