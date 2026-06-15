import asyncio
import json as _json
import os
from contextlib import asynccontextmanager
from pathlib import Path as _Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.openapi.docs import get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse

load_dotenv(override=False)


def _load_runtime_config() -> dict[str, Any]:
    # tavro-api mounts the runtime config volume at /app/static/runtime
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


def _get_zitadel_issuer() -> str:
    rt = _load_runtime_config()
    return (
        rt.get("zitadelIssuer")
        or os.getenv("ZITADEL_ISSUER")
        or os.getenv("VITE_ZITADEL_ISSUER")
        or ""
    ).rstrip("/")


def _get_zitadel_client_id() -> str:
    rt = _load_runtime_config()
    return (
        rt.get("zitadelClientId")
        or os.getenv("VITE_ZITADEL_CLIENT_ID")
        or os.getenv("ZITADEL_CLIENT_ID")
        or ""
    )


from fastapi.middleware.cors import CORSMiddleware
from temporalio.worker import Worker
from temporalio.client import Client

from api.routers import companies, dim_types, dim_nodes, dim_edges, source_refs, graph
from api.routers.dim_types import seed_system_dim_types
from api.routers.spark import ensure_spark_table
from api.routers import blueprint
from api.routers import playground
from api.routers import compliance, compliance_research
from api.routers import audit
from api.routers import risk
from api.routers import business_relations
from api.routers import agents
from api.routers import agent_upload
from api.routers import use_cases
from api.routers import use_case_upload
from api.routers import insights
from api.routers import ai_models
from api.routers import drive_import
from api.routers import spark
from api.routers import docker_logs
from api.routers.docker_logs import start_log_collector
from api.migrations.init_tables import initialize_tables
from api.database import get_db
from api.dependencies.auth import require_authenticated_user
from api.routers import token as token_router

from services.workflow.workflow import RiskManagerWorkflow
from services.activity.activities import (
    classify_risk_activity,
    aars_risk_evaluation_activity,
    insert_risk_assessment_activity,
    score_cvss_activity,
    update_cvss_activity,
    insert_core_activity,
    summary_activity,
    insert_summary_activity,
    update_data_sources,
    refresh_curated_agent_360_activity,
    create_local_agent_card_activity,
)

TASK_QUEUE = "risk-classification-queue"
TEMPORAL_ADDRESS = os.getenv("TEMPORAL_ADDRESS", "risk-temporal:7233")


async def _run_temporal_worker():
    print("Connecting Temporal worker...")
    client = await Client.connect(TEMPORAL_ADDRESS)
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[RiskManagerWorkflow],
        activities=[
            classify_risk_activity,
            aars_risk_evaluation_activity,
            insert_risk_assessment_activity,
            score_cvss_activity,
            update_cvss_activity,
            insert_core_activity,
            summary_activity,
            insert_summary_activity,
            update_data_sources,
            refresh_curated_agent_360_activity,
            create_local_agent_card_activity,
        ],
    )
    print(f"Temporal worker listening on queue: {TASK_QUEUE}")
    await worker.run()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables
    async for db in get_db():
        await initialize_tables(db)
        break

    await seed_system_dim_types()
    await ensure_spark_table()
    await start_log_collector()
    worker_task = asyncio.create_task(_run_temporal_worker())
    yield
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Tavro API",
    description="REST API for the Tavro digital twin and risk classification platform.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,  # disabled — custom /docs below injects correct Zitadel config at request time
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _custom_openapi() -> dict[str, Any]:
    # Not cached — regenerated on every /openapi.json request so ZITADEL_ISSUER
    # is always read from the current environment / runtime config.
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description or "",
        routes=app.routes,
    )

    # Replace the auto-generated HTTPBearer (http, Bearer) scheme with an OAuth2
    # password flow pointing at our custom /api/v1/token endpoint. Swagger UI
    # will show username + password fields; the endpoint handles the Zitadel
    # Sessions API flow internally — no browser redirect needed.
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["HTTPBearer"] = {
        "type": "oauth2",
        "flows": {
            "password": {
                "tokenUrl": "/api/v1/token",
                "scopes": {
                    "openid": "OpenID Connect",
                    "profile": "User profile",
                    "email": "Email address",
                },
            }
        },
    }

    return schema


app.openapi = _custom_openapi  # type: ignore[method-assign]


@app.get("/docs", include_in_schema=False)
async def swagger_ui_html() -> HTMLResponse:
    """Serves Swagger UI — client_id injected server-side, hidden from the form."""
    base = get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{app.title} — Swagger UI",
        oauth2_redirect_url="/docs/oauth2-redirect",
        init_oauth={
            "clientId": _get_zitadel_client_id(),
            "scopes": "openid profile email urn:zitadel:iam:user:resourceowner",
        },
        swagger_ui_parameters={"persistAuthorization": True},
    )
    # client_id is pre-filled via init_oauth and sent silently on every token request.
    # Hide the entire .wrapper row so no empty space is left behind.
    inject = """<style>
      /* Direct element hiding */
      #client_id, label[for="client_id"],
      #client_secret, label[for="client_secret"] { display: none !important; }
      /* Also hide the wrapper row via :has() for modern browsers */
      .wrapper:has(#client_id), .wrapper:has(#client_secret) { display: none !important; }
    </style>
    <script>
      (function () {
        function forceHide(el) {
          if (el) el.style.setProperty("display", "none", "important");
        }
        function hideCredentialFields() {
          ["client_id", "client_secret"].forEach(function (id) {
            var input = document.getElementById(id);
            if (!input) return;
            forceHide(input);
            forceHide(document.querySelector('label[for="' + id + '"]'));
            // Hide the whole .wrapper row so no blank space remains
            forceHide(input.closest(".wrapper") || input.parentElement);
          });
          // Also catch inputs by data-name in case the id changes across Swagger UI versions
          ["clientId", "clientSecret"].forEach(function (name) {
            document.querySelectorAll('[data-name="' + name + '"]').forEach(function (el) {
              forceHide(el.closest(".wrapper") || el.parentElement);
            });
          });
          // Hide "Client credentials location" row
          var loc = document.querySelector('[data-name="credentialsLocation"]') ||
                    document.getElementById("client-credentials-location");
          if (loc) forceHide(loc.closest(".wrapper") || loc.parentElement);
        }
        // Run immediately AND on every future DOM change (modal opens dynamically)
        new MutationObserver(hideCredentialFields).observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener("DOMContentLoaded", hideCredentialFields);
      })();
    </script>"""
    html = base.body.decode("utf-8").replace("</head>", f"{inject}</head>", 1)
    return HTMLResponse(content=html, status_code=200)


# Token endpoint — no auth dependency, this IS the auth endpoint
app.include_router(token_router.router, prefix="/api/v1", tags=["Auth"])

_auth = [Depends(require_authenticated_user)]

# ── Digital Twin routes ───────────────────────────────────────────────────────
app.include_router(companies.router,   prefix="/api/v1/companies",   tags=["Companies"],           dependencies=_auth)
app.include_router(dim_types.router,   prefix="/api/v1/dim-types",   tags=["Dimension Types"],     dependencies=_auth)
app.include_router(dim_nodes.router,   prefix="/api/v1/dim-nodes",   tags=["Dimension Nodes"],     dependencies=_auth)
app.include_router(dim_edges.router,   prefix="/api/v1/dim-edges",   tags=["Dimension Edges"],     dependencies=_auth)
app.include_router(source_refs.router, prefix="/api/v1/source-refs", tags=["Source References"],   dependencies=_auth)
app.include_router(graph.router,       prefix="/api/v1/graph",       tags=["Graph"],               dependencies=_auth)
app.include_router(blueprint.router,   prefix="/api/v1/blueprint",   tags=["Blueprint"],           dependencies=_auth)
app.include_router(playground.router,  prefix="/api/v1/playground",  tags=["Playground"],          dependencies=_auth)
app.include_router(compliance.router,          prefix="/api/v1/compliance", tags=["Compliance"],          dependencies=_auth)
app.include_router(compliance_research.router, prefix="/api/v1/compliance", tags=["Compliance Research"], dependencies=_auth)
app.include_router(audit.router,       prefix="/api/v1/audit",       tags=["Audit"],               dependencies=_auth)
app.include_router(business_relations.router, prefix="/api/v1",                                    dependencies=_auth)
app.include_router(agents.router,    prefix="/api/v1/agents",     tags=["Agents"],                 dependencies=_auth)
app.include_router(agent_upload.router,  prefix="/api/v1/agents",     tags=["Agents"],             dependencies=_auth)
app.include_router(use_cases.router,        prefix="/api/v1/use-cases",  tags=["AI Use Cases"],    dependencies=_auth)
app.include_router(use_case_upload.router,  prefix="/api/v1/use-cases",  tags=["AI Use Cases"],    dependencies=_auth)
app.include_router(insights.router,         prefix="/api/v1/insights",   tags=["Insights"],        dependencies=_auth)
app.include_router(ai_models.router,         prefix="/api/v1/ai-models",  tags=["AI Models"],      dependencies=_auth)
app.include_router(drive_import.router,     prefix="/api/v1/drive",      tags=["Drive Import"],    dependencies=_auth)
app.include_router(spark.router,            prefix="/api/v1/spark",      tags=["Spark"],           dependencies=_auth)
app.include_router(docker_logs.router,      prefix="/api/v1/docker-logs", tags=["Docker Logs"],    dependencies=_auth)

# ── Risk Classification routes ────────────────────────────────────────────────
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk"], dependencies=_auth)


@app.get("/docs/oauth2-redirect", include_in_schema=False)
async def swagger_oauth2_redirect() -> HTMLResponse:
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/debug-claims", include_in_schema=False)
async def debug_claims(user: dict = Depends(require_authenticated_user)):
    """Temporary — dumps raw JWT claims so we can identify the correct tenant claim key."""
    return {
        "tenant_id_resolved": user.get("tenant_id"),
        "claims": user.get("claims", {}),
    }


@app.get("/api/v1/debug-auth-config", include_in_schema=False)
def debug_auth_config():
    """Temporary — shows resolved Zitadel config so we can verify env/runtime loading."""
    from dotenv import dotenv_values

    rt = _load_runtime_config()
    issuer = _get_zitadel_issuer()
    client_id = _get_zitadel_client_id()

    # Check what's actually in the .env file on disk
    dotenv_file_values = dotenv_values("/app/.env")
    runtime_paths_checked = [
        "/app/static/runtime/tavro-runtime-config.json",
        "/app/runtime/tavro-runtime-config.json",
        "/runtime/tavro-runtime-config.json",
    ]
    runtime_paths_exist = {p: _Path(p).exists() for p in runtime_paths_checked}

    return {
        "resolved_issuer": issuer or "(empty)",
        "resolved_client_id": client_id[:8] + "..." if client_id else "(empty)",
        "env_ZITADEL_ISSUER": os.getenv("ZITADEL_ISSUER", "(not set)"),
        "env_VITE_ZITADEL_ISSUER": os.getenv("VITE_ZITADEL_ISSUER", "(not set)"),
        "dotenv_VITE_ZITADEL_ISSUER": dotenv_file_values.get("VITE_ZITADEL_ISSUER", "(not in file)"),
        "dotenv_file_exists": _Path("/app/.env").exists(),
        "runtime_config_keys": list(rt.keys()),
        "runtime_paths_exist": runtime_paths_exist,
    }
