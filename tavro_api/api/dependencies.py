from fastapi import Header, HTTPException


def require_tenant(x_tenant_id: str = Header(None, alias="x-tenant-id")) -> str:
    if not x_tenant_id or not x_tenant_id.strip():
        raise HTTPException(status_code=400, detail="Missing tenant context.")
    return x_tenant_id.strip()
