# =============================================================
# Tavro Digital Twin — FastAPI
# main.py
# =============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import companies, dim_types, dim_nodes, dim_edges, source_refs, graph

from api.routers import blueprint

from api.routers import playground

from api.routers import compliance, compliance_research

from api.routers import audit

app = FastAPI(
    title="Tavro Digital Twin API",
    description="REST API for browsing, editing, and visualising the Tavro digital twin.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your React dev server in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router,   prefix="/api/v1/companies",   tags=["Companies"])
app.include_router(dim_types.router,   prefix="/api/v1/dim-types",   tags=["Dimension Types"])
app.include_router(dim_nodes.router,   prefix="/api/v1/dim-nodes",   tags=["Dimension Nodes"])
app.include_router(dim_edges.router,   prefix="/api/v1/dim-edges",   tags=["Dimension Edges"])
app.include_router(source_refs.router, prefix="/api/v1/source-refs", tags=["Source References"])
app.include_router(graph.router,       prefix="/api/v1/graph",       tags=["Graph"])
app.include_router(blueprint.router,   prefix="/api/v1/blueprint",   tags=["Blueprint"])
app.include_router(playground.router,  prefix="/api/v1/playground",  tags=["Playground"])

app.include_router(compliance.router,          prefix="/api/v1/compliance",          tags=["Compliance"])
app.include_router(compliance_research.router, prefix="/api/v1/compliance",          tags=["Compliance Research"])

app.include_router(audit.router, prefix="/api/v1/audit", tags=["Audit"])

@app.get("/health")
def health():
    return {"status": "ok"}
