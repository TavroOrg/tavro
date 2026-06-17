# =============================================================
# api/enterprise_proxy.py
# Forwards /compliance/* and /audit/* to the enterprise service.
# Handles both regular JSON responses and SSE streaming.
# =============================================================

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

# Headers that must not be forwarded between proxies
_HOP_BY_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
})


def make_govern_proxy(enterprise_url: str) -> APIRouter:
    """
    Returns a router that proxies /compliance/* and /audit/* to the
    enterprise service at enterprise_url.  Register it at prefix /api/v1.
    """
    router = APIRouter()
    base   = enterprise_url.rstrip("/")

    async def _proxy(request: Request, upstream_path: str) -> Response:
        url = f"{base}/{upstream_path}"
        if request.url.query:
            url = f"{url}?{request.url.query}"

        headers = {
            k: v for k, v in request.headers.items()
            if k.lower() not in _HOP_BY_HOP
        }
        body   = await request.body()
        is_sse = upstream_path.endswith("/stream")

        if is_sse:
            async def _sse_stream():
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        method=request.method,
                        url=url,
                        headers=headers,
                        content=body,
                    ) as resp:
                        async for chunk in resp.aiter_bytes():
                            yield chunk

            return StreamingResponse(
                _sse_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
            )

        resp_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in _HOP_BY_HOP
        }
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
        )

    # ── Compliance routes ─────────────────────────────────────────────────────
    @router.api_route("/compliance", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def proxy_compliance_root(request: Request):
        return await _proxy(request, "api/v1/compliance")

    @router.api_route("/compliance/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def proxy_compliance(request: Request, path: str):
        return await _proxy(request, f"api/v1/compliance/{path}")

    # ── Audit routes ──────────────────────────────────────────────────────────
    @router.api_route("/audit", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def proxy_audit_root(request: Request):
        return await _proxy(request, "api/v1/audit")

    @router.api_route("/audit/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def proxy_audit(request: Request, path: str):
        return await _proxy(request, f"api/v1/audit/{path}")

    return router
