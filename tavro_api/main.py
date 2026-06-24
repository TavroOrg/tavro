import asyncio
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(override=False)
from fastapi.middleware.cors import CORSMiddleware
from temporalio.worker import Worker
from temporalio.client import Client

from api.routers import companies, dim_types, dim_nodes, dim_edges, source_refs, graph
from api.routers.dim_types import seed_system_dim_types
from api.routers.spark import ensure_spark_table
from api.routers import blueprint
from api.routers import playground
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
from api.routers import claude_run
from api.routers import azure_deploy
from api.migrations.init_tables import initialize_tables
from api.database import get_db

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

TASK_QUEUE        = "risk-classification-queue"
AUDIT_TASK_QUEUE  = "audit-assessment-queue"
TEMPORAL_ADDRESS  = os.getenv("TEMPORAL_ADDRESS", "risk-temporal:7233")
_ENTERPRISE_ENABLED = os.getenv("BUILD_MODE", "").strip().lower() == "enterprise"


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


async def _run_audit_temporal_worker():
    from api.temporal.workflow import AuditWorkflow
    from api.temporal.activities import run_audit_orchestrator_activity

    print("Connecting enterprise audit Temporal worker...")
    client = await Client.connect(TEMPORAL_ADDRESS)
    worker = Worker(
        client,
        task_queue=AUDIT_TASK_QUEUE,
        workflows=[AuditWorkflow],
        activities=[run_audit_orchestrator_activity],
    )
    print(f"Audit Temporal worker listening on queue: {AUDIT_TASK_QUEUE}")
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
    audit_worker_task = None
    if _ENTERPRISE_ENABLED:
        audit_worker_task = asyncio.create_task(_run_audit_temporal_worker())
    yield
    worker_task.cancel()
    if audit_worker_task:
        audit_worker_task.cancel()
        try:
            await audit_worker_task
        except asyncio.CancelledError:
            pass
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Tavro API",
    description="REST API for the Tavro digital twin and risk classification platform.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Digital Twin routes ───────────────────────────────────────────────────────
app.include_router(companies.router,   prefix="/api/v1/companies",   tags=["Companies"])
app.include_router(dim_types.router,   prefix="/api/v1/dim-types",   tags=["Dimension Types"])
app.include_router(dim_nodes.router,   prefix="/api/v1/dim-nodes",   tags=["Dimension Nodes"])
app.include_router(dim_edges.router,   prefix="/api/v1/dim-edges",   tags=["Dimension Edges"])
app.include_router(source_refs.router, prefix="/api/v1/source-refs", tags=["Source References"])
app.include_router(graph.router,       prefix="/api/v1/graph",       tags=["Graph"])
app.include_router(blueprint.router,   prefix="/api/v1/blueprint",   tags=["Blueprint"])
app.include_router(playground.router,  prefix="/api/v1/playground",  tags=["Playground"])
# ── Govern module (enterprise-only) ──────────────────────────────────────────
# BUILD_MODE=enterprise means the entrypoint copied enterprise routers into
# /app/api/routers/ before uvicorn started.  Any other value uses stubs.
_ENTERPRISE_ENABLED = os.getenv("BUILD_MODE", "").strip().lower() == "enterprise"
if _ENTERPRISE_ENABLED:
    from api.routers import compliance, compliance_research, audit
    app.include_router(compliance.router,          prefix="/api/v1/compliance", tags=["Compliance"])
    app.include_router(compliance_research.router, prefix="/api/v1/compliance", tags=["Compliance Research"])
    app.include_router(audit.router,               prefix="/api/v1/audit",      tags=["Audit"])
else:
    from api.govern_stub import router as _govern_stub
    app.include_router(_govern_stub, prefix="/api/v1", tags=["Govern"])
app.include_router(business_relations.router, prefix="/api/v1")
app.include_router(agents.router,    prefix="/api/v1/agents",     tags=["Agents"])
app.include_router(agent_upload.router,  prefix="/api/v1/agents",     tags=["Agents"])
app.include_router(use_cases.router,        prefix="/api/v1/use-cases",  tags=["AI Use Cases"])
app.include_router(use_case_upload.router,  prefix="/api/v1/use-cases",  tags=["AI Use Cases"])
app.include_router(insights.router,         prefix="/api/v1/insights",   tags=["Insights"])
app.include_router(ai_models.router,         prefix="/api/v1/ai-models",  tags=["AI Models"])
app.include_router(drive_import.router,     prefix="/api/v1/drive",      tags=["Drive Import"])
app.include_router(spark.router,            prefix="/api/v1/spark",      tags=["Spark"])
app.include_router(docker_logs.router,      prefix="/api/v1/docker-logs", tags=["Docker Logs"])
app.include_router(claude_run.router)
app.include_router(azure_deploy.router)

# ── Risk Classification routes ────────────────────────────────────────────────
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/enterprise/status")
async def enterprise_status():
    return {"enabled": _ENTERPRISE_ENABLED}
