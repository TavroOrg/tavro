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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.routers import llm_keys, config, connectors

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


# ── Serve React static files (SPA fallback) ───────────────────────────────────
# This must come LAST so API routes take priority.

_STATIC_DIR = Path(__file__).parent.parent / "static"
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
