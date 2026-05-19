import os
import base64
import json
from typing import Any, Literal
from urllib.parse import urlparse, urlunparse

import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
from fastmcp.server.auth.auth import AccessToken
from fastmcp.server.auth.providers.jwt import JWTVerifier, parse_scopes
from pydantic import AnyHttpUrl

from risk_agents.users import get_approved_user


def _issuer_to_config_url(issuer: str) -> str:
    issuer = issuer.rstrip("/")
    return f"{issuer}/.well-known/openid-configuration"


def _normalize_config_url(config_url: AnyHttpUrl | str | None, issuer: str) -> str:
    if not config_url:
        return _issuer_to_config_url(issuer)

    value = str(config_url).rstrip("/")
    if value.endswith("/.well-known/openid-configuration"):
        return value

    return f"{value}/.well-known/openid-configuration"


def _with_base_url(value: str | None, base_url: str) -> str | None:
    if not value:
        return value

    parsed_value = urlparse(value)
    parsed_base = urlparse(base_url.rstrip("/"))
    if not parsed_value.scheme or not parsed_value.netloc:
        return value

    return urlunparse(
        parsed_value._replace(
            scheme=parsed_base.scheme,
            netloc=parsed_base.netloc,
        )
    )


def _internal_headers() -> dict[str, str] | None:
    host_header = os.getenv("ZITADEL_INTERNAL_HOST_HEADER", "").strip()
    if not host_header:
        return None

    return {"Host": host_header}


def _redirect_path_from_env() -> str:
    redirect_uri = os.getenv("ZITADEL_REDIRECT_URI", "").strip()
    redirect_path = os.getenv("ZITADEL_REDIRECT_PATH", "").strip()

    if redirect_path:
        return redirect_path if redirect_path.startswith("/") else f"/{redirect_path}"

    if redirect_uri:
        parsed = urlparse(redirect_uri)
        if parsed.path:
            return parsed.path

    return "/oauth/callback"


def _email_like(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    email = value.strip().lower()
    if "@" not in email:
        return None

    return email


class ZitadelProvider(OIDCProxy):
    """ZITADEL OIDC provider for FastMCP's OAuth proxy.

    ZITADEL is standards-compliant OIDC, so the FastMCP OIDC proxy can handle
    the MCP-facing dynamic client registration while ZITADEL remains the
    upstream identity provider.
    """

    def __init__(
        self,
        *,
        issuer: str,
        client_id: str,
        client_secret: str | None = None,
        base_url: AnyHttpUrl | str,
        config_url: AnyHttpUrl | str | None = None,
        resource_base_url: AnyHttpUrl | str | None = None,
        issuer_url: AnyHttpUrl | str | None = None,
        redirect_path: str | None = None,
        required_scopes: list[str] | str | None = None,
        allowed_client_redirect_uris: list[str] | None = None,
        jwt_signing_key: str | bytes | None = None,
        require_authorization_consent: bool | Literal["external"] = "external",
        forward_resource: bool = False,
        prompt: str | None = None,
    ) -> None:
        if not issuer:
            raise ValueError("Missing required ZITADEL issuer")
        if not client_id:
            raise ValueError("Missing required ZITADEL client id")

        scopes = (
            parse_scopes(required_scopes)
            if required_scopes
            else ["openid", "profile", "email"]
        )
        token_endpoint_auth_method = "none"
        extra_authorize_params = {}
        if prompt:
            extra_authorize_params["prompt"] = prompt

        print("ZITADEL REDIRECT PATH:", redirect_path or _redirect_path_from_env())
        print("ZITADEL BASE URL:", base_url)
        if os.getenv("ZITADEL_INTERNAL_BASE_URL"):
            print("ZITADEL INTERNAL BASE URL:", os.getenv("ZITADEL_INTERNAL_BASE_URL"))
        if os.getenv("ZITADEL_INTERNAL_HOST_HEADER"):
            print("ZITADEL INTERNAL HOST HEADER:", os.getenv("ZITADEL_INTERNAL_HOST_HEADER"))

        super().__init__(
            config_url=_normalize_config_url(config_url, issuer),
            client_id=client_id,
            client_secret=None,
            base_url=base_url,
            resource_base_url=resource_base_url,
            issuer_url=issuer_url or base_url,
            redirect_path=redirect_path or _redirect_path_from_env(),
            required_scopes=scopes,
            allowed_client_redirect_uris=allowed_client_redirect_uris,
            jwt_signing_key=jwt_signing_key,
            token_endpoint_auth_method=token_endpoint_auth_method,
            require_authorization_consent=require_authorization_consent,
            forward_resource=forward_resource,
            verify_id_token=True,
            extra_authorize_params=extra_authorize_params or None,
        )

    def get_oidc_configuration(
        self,
        config_url: AnyHttpUrl,
        strict: bool | None,
        timeout_seconds: int | None,
    ) -> OIDCConfiguration:
        get_kwargs: dict[str, Any] = {}
        if timeout_seconds is not None:
            get_kwargs["timeout"] = timeout_seconds
        headers = _internal_headers()
        if headers:
            get_kwargs["headers"] = headers

        response = httpx.get(str(config_url), **get_kwargs)
        response.raise_for_status()

        config_data = response.json()
        if strict is not None:
            config_data["strict"] = strict

        internal_base_url = os.getenv("ZITADEL_INTERNAL_BASE_URL", "").strip()
        if internal_base_url:
            # Browser redirects must keep the public localhost issuer, but the
            # container needs internal URLs for server-side token/JWKS/userinfo calls.
            for key in (
                "token_endpoint",
                "introspection_endpoint",
                "userinfo_endpoint",
                "revocation_endpoint",
                "jwks_uri",
                "device_authorization_endpoint",
            ):
                config_data[key] = _with_base_url(config_data.get(key), internal_base_url)

        return OIDCConfiguration.model_validate(config_data)

    def get_token_verifier(
        self,
        *,
        algorithm: str | None = None,
        audience: str | None = None,
        required_scopes: list[str] | None = None,
        timeout_seconds: int | None = None,
    ) -> JWTVerifier:
        headers = _internal_headers()
        http_client = (
            httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(10.0))
            if headers
            else None
        )
        return JWTVerifier(
            jwks_uri=str(self.oidc_config.jwks_uri),
            issuer=str(self.oidc_config.issuer),
            algorithm=algorithm,
            audience=audience,
            required_scopes=required_scopes,
            http_client=http_client,
        )

    def _create_upstream_oauth_client(self) -> AsyncOAuth2Client:
        client_kwargs: dict[str, Any] = {
            "client_id": self._upstream_client_id,
            "client_secret": None,
            "token_endpoint_auth_method": self._token_endpoint_auth_method,
            "timeout": 30,
        }
        headers = _internal_headers()
        if headers:
            client_kwargs["headers"] = headers

        return AsyncOAuth2Client(**client_kwargs)

    @staticmethod
    def _decode_jwt_payload(token: str | None) -> dict[str, Any]:
        if not token:
            return {}

        try:
            payload = token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            return json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
        except Exception as exc:
            print(f"[DEBUG] Failed to decode ZITADEL token payload: {exc}")
            return {}

    async def _extract_upstream_claims(
        self, idp_tokens: dict[str, Any]
    ) -> dict[str, Any] | None:
        claims = self._decode_jwt_payload(idp_tokens.get("id_token"))
        userinfo_claims = await self._fetch_userinfo_claims(idp_tokens.get("access_token"))
        claims = {**claims, **userinfo_claims}
        if not claims:
            return None

        return {
            key: value
            for key, value in {
                "sub": claims.get("sub"),
                "name": claims.get("name"),
                "email": claims.get("email"),
                "email_verified": claims.get("email_verified"),
                "preferred_username": claims.get("preferred_username"),
                "login_name": (
                    claims.get("login_name")
                    or claims.get("loginName")
                    or claims.get("urn:zitadel:iam:user:loginname")
                    or claims.get("urn:zitadel:iam:user:preferred_login_name")
                ),
            }.items()
            if value is not None
        }

    async def _fetch_userinfo_claims(self, upstream_access_token: str | None) -> dict[str, Any]:
        userinfo_endpoint = getattr(self.oidc_config, "userinfo_endpoint", None)
        if not upstream_access_token or not userinfo_endpoint:
            return {}

        try:
            headers = _internal_headers()
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    str(userinfo_endpoint),
                    headers={
                        **(headers or {}),
                        "Authorization": f"Bearer {upstream_access_token}",
                    },
                )
        except Exception as exc:
            print(f"[DEBUG] ZITADEL userinfo fetch failed: {exc}")
            return {}

        if response.status_code != 200:
            print(
                "[DEBUG] ZITADEL userinfo returned "
                f"{response.status_code}: {response.text[:250]}"
            )
            return {}

        try:
            data = response.json()
        except ValueError as exc:
            print(f"[DEBUG] ZITADEL userinfo JSON decode failed: {exc}")
            return {}

        if isinstance(data, dict):
            return data
        return {}

    @staticmethod
    def _resolve_email(claims: dict[str, Any], upstream_claims: dict[str, Any]) -> str | None:
        candidates = (
            claims.get("email"),
            upstream_claims.get("email"),
            claims.get("preferred_username"),
            upstream_claims.get("preferred_username"),
            claims.get("login_name"),
            upstream_claims.get("login_name"),
        )

        for candidate in candidates:
            email = _email_like(candidate)
            if email:
                return email

        return None

    async def load_access_token(self, token: str) -> AccessToken | None:
        access_token = await super().load_access_token(token)
        if access_token is None:
            print("[DEBUG] FastMCP token could not be loaded or upstream token validation failed")
            return None

        claims = access_token.claims or {}
        upstream_claims = claims.get("upstream_claims") or {}
        email = self._resolve_email(claims, upstream_claims)

        if not email:
            print("[DEBUG] No email claim found in ZITADEL token/userinfo claims")
            print(f"  sub      : {claims.get('sub') or upstream_claims.get('sub')}")
            print(f"  username : {claims.get('preferred_username') or upstream_claims.get('preferred_username')}")
            return None

        approved_user = await get_approved_user(email)
        if approved_user is None:
            print(f"[DEBUG] No approved ZITADEL user found for email: {email}")
            return None

        enriched_claims = {
            **claims,
            **upstream_claims,
            "email": approved_user.email,
            "tenant_id": approved_user.tenant_id,
        }

        print("[DEBUG] ===== ZITADEL AUTH SUCCESS =====")
        print(f"  sub      : {enriched_claims.get('sub')}")
        print(f"  username : {enriched_claims.get('preferred_username')}")
        print(f"  email    : {enriched_claims.get('email')}")
        print(f"  tenant_id: {enriched_claims.get('tenant_id')}")

        return access_token.model_copy(update={"claims": enriched_claims})


__all__ = ["ZitadelProvider"]
