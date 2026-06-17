# =============================================================
# api/govern_stub.py
# Returned when ENTERPRISE_URL is not set.
# All /compliance and /audit routes respond with 402.
# =============================================================

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_DETAIL = {"detail": "This feature requires a Tavro Enterprise license."}


@router.api_route("/compliance", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def stub_compliance_root(request: Request):
    return JSONResponse(status_code=402, content=_DETAIL)


@router.api_route("/compliance/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def stub_compliance(request: Request, path: str):
    return JSONResponse(status_code=402, content=_DETAIL)


@router.api_route("/audit", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def stub_audit_root(request: Request):
    return JSONResponse(status_code=402, content=_DETAIL)


@router.api_route("/audit/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def stub_audit(request: Request, path: str):
    return JSONResponse(status_code=402, content=_DETAIL)
