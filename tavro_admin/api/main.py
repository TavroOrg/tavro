"""
Admin Portal API — FastAPI application running on port 7000.

Routes:
  /api/v1/admin/...   →  Admin API endpoints
  /docs               →  Swagger UI
  /health             →  Health check
  /*                  →  React admin frontend (static files)
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.routers import llm_keys, config, connectors
from api.dependencies.auth import require_portal_admin

# ── Admin schema DDL paths ─────────────────────────────────────────────────────

_DDL_CANDIDATES = (
    Path("/sql/admin/01_admin_schema.sql"),
    Path(__file__).resolve().parents[2] / "sql" / "admin" / "01_admin_schema.sql",
)


async def _bootstrap_admin_schema() -> None:
    for path in _DDL_CANDIDATES:
        if path.exists():
            ddl = path.read_text(encoding="utf-8")
            break
    else:
        print("[admin] WARNING: admin DDL not found — skipping schema bootstrap")
        return

    statements = [s.strip() for s in ddl.split(";") if s.strip()]
    async with AsyncSessionLocal() as db:
        for stmt in statements:
            await db.execute(text(stmt))
        await db.commit()
    print("[admin] Admin schema bootstrap complete")


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await _bootstrap_admin_schema()
    yield


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Tavro Admin API",
    description="Admin Portal REST API — LLM keys, configuration, and connector management.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes (must be registered before static files) ───────────────────────

app.include_router(llm_keys.router,  prefix="/api/v1/admin", tags=["LLM Keys"])
app.include_router(config.router,    prefix="/api/v1/admin", tags=["Config"])
app.include_router(connectors.router, prefix="/api/v1/admin", tags=["Connectors"])


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}


@app.get("/api/v1/admin/me", tags=["Auth"])
async def get_me(auth: dict = Depends(require_portal_admin)):
    """Verifies the bearer token via ZITADEL userinfo and confirms portal_admin role.
    Used by the frontend after token exchange to gate dashboard access."""
    return {
        "email": auth["claims"].get("email"),
        "tenant_id": auth["tenant_id"],
    }


# ── Serve React static files (SPA fallback) ───────────────────────────────────
# Must come LAST so API routes take priority.
# Uses a catch-all route instead of StaticFiles so React Router paths like
# /auth/callback resolve to index.html rather than 404.

_STATIC_DIR = Path(__file__).parent.parent / "static"
_STATIC_ROOT = _STATIC_DIR.resolve()


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    target = (_STATIC_DIR / full_path).resolve()
    # Guard against path traversal
    if target.is_file() and str(target).startswith(str(_STATIC_ROOT)):
        return FileResponse(str(target))
    index = _STATIC_DIR / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    raise HTTPException(status_code=404)
