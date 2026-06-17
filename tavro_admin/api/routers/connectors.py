"""
Connector run endpoints — two-phase execution.

Phase 1 — Extraction (sync, runs in a thread, returns immediately)
  Saves agent card JSONs, refreshes curated.agent_360, collects metadata.

Phase 2 — Risk Assessment Queue (FastAPI BackgroundTask — after HTTP response)
  Max RISK_CONCURRENCY workflows run at a time.
  The /classify-risk POST blocks until Temporal finishes, so the semaphore
  slot is held for the full workflow duration naturally.
  Failures are fully isolated — one agent never affects others.
"""
from __future__ import annotations

import asyncio
import importlib
import io
import json
import os
import threading
import urllib.parse
from contextlib import redirect_stdout
from pathlib import Path

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.dependencies.auth import _extract_tenant_id, _ZITADEL_INTERNAL_URL, _ZITADEL_INTERNAL_HOST

router = APIRouter()

AGENT_CARD_DIR   = os.getenv("AGENT_CARD_DIR",    "/app/agent_cards")
RISK_URL         = os.getenv("RISK_CLASSIFY_URL",  "http://tavro-api:8000/api/v1/risk/classify-risk")
RISK_CONCURRENCY = int(os.getenv("RISK_CONCURRENCY", "2"))
RISK_TIMEOUT_S   = int(os.getenv("RISK_TIMEOUT_S",   "600"))

CONNECTOR_MAP: dict[str, tuple[str, str]] = {
    "copilot":    ("catalog_connector.connector.copilot_connector",    "CopilotConnector"),
    "bedrock":    ("catalog_connector.connector.bedrock_connector",     "BedrockConnector"),
    "salesforce": ("catalog_connector.connector.salesforce_connector",  "SalesforceConnector"),
    "servicenow": ("catalog_connector.connector.servicenow_connector",  "ServiceNowConnector"),
    "snowflake":  ("catalog_connector.connector.snowflake_connector",   "SnowflakeConnector"),
    "databricks": ("catalog_connector.connector.databricks_connector",  "DatabricksConnector"),
    "gemini":     ("catalog_connector.connector.gemini_connector",      "GeminiConnector"),
    "github":     ("catalog_connector.connector.mcp_connector.github_connector", "GitHubConnector"),
}

_connector_lock = threading.Lock()

# ── curated.agent_360 refresh ─────────────────────────────────────────────────

_REFRESH_DELETE_SQL = """
    DELETE FROM curated.agent_360
    WHERE (agent_internal_id = :ai_id OR agent_id = :a_id)
      AND (:tid IS NULL OR tenant_id = :tid)
"""

_REFRESH_INSERT_SQL = """
    INSERT INTO curated.agent_360 (
        tenant_id, agent_id, agent_name, agent_description,
        autonomy_level, memory_type, reasoning_model,
        tool_count, data_source_count,
        business_application_count, business_process_count, ai_model_count,
        primary_ai_model_name, primary_ai_model_provider,
        contains_pii, contains_phi, contains_pci,
        latest_risk_score, latest_risk_class, latest_event_status,
        snapshot_ts, agent_internal_id, summary
    )
    SELECT
        a.tenant_id, a.agent_id, a.agent_name, a.agent_description,
        cfg.autonomy_level, cfg.memory_type, cfg.reasoning_model,
        COALESCE(t.tool_count,   0), COALESCE(ds.ds_count,    0),
        COALESCE(ap.app_count,   0), COALESCE(pr.proc_count,  0),
        COALESCE(mo.model_count, 0),
        pm.model_name, pm.model_provider,
        COALESCE(ds.has_pii, FALSE), COALESCE(ds.has_phi, FALSE), COALESCE(ds.has_pci, FALSE),
        NULL, NULL, NULL, CURRENT_TIMESTAMP, a.agent_internal_id, NULL
    FROM core.agents a
    LEFT JOIN core.agent_configurations cfg
        ON cfg.agent_internal_id = a.agent_internal_id AND COALESCE(cfg.is_current, TRUE) = TRUE
    LEFT JOIN (SELECT agent_internal_id, COUNT(*)::bigint AS tool_count FROM core.agent_tools GROUP BY agent_internal_id) t ON t.agent_internal_id = a.agent_internal_id
    LEFT JOIN (SELECT agent_internal_id, COUNT(*)::bigint AS ds_count, BOOL_OR(COALESCE(contains_pii,FALSE)) AS has_pii, BOOL_OR(COALESCE(contains_phi,FALSE)) AS has_phi, BOOL_OR(COALESCE(contains_pci,FALSE)) AS has_pci FROM core.agent_data_sources GROUP BY agent_internal_id) ds ON ds.agent_internal_id = a.agent_internal_id
    LEFT JOIN (SELECT agent_internal_id, COUNT(*)::bigint AS app_count FROM core.agent_business_applications GROUP BY agent_internal_id) ap ON ap.agent_internal_id = a.agent_internal_id
    LEFT JOIN (SELECT agent_internal_id, COUNT(*)::bigint AS proc_count FROM core.agent_business_processes GROUP BY agent_internal_id) pr ON pr.agent_internal_id = a.agent_internal_id
    LEFT JOIN (SELECT agent_internal_id, COUNT(*)::bigint AS model_count FROM core.agent_ai_models GROUP BY agent_internal_id) mo ON mo.agent_internal_id = a.agent_internal_id
    LEFT JOIN LATERAL (
        SELECT COALESCE(cat.model_name, rel.model_name) AS model_name,
               cat.provider                             AS model_provider
        FROM   core.agent_ai_models rel
        LEFT JOIN core.ai_models cat
            ON LOWER(TRIM(cat.ai_model_id)) = LOWER(TRIM(rel.ai_model_id))
        WHERE  rel.agent_internal_id = a.agent_internal_id
        ORDER  BY rel.created_ts DESC NULLS LAST
        LIMIT  1
    ) pm ON TRUE
    WHERE a.agent_internal_id = :ai_id AND COALESCE(a.is_current, TRUE) = TRUE AND (:tid IS NULL OR a.tenant_id = :tid)
"""


def _refresh_agent_360_sync(agent_internal_id: str, agent_id: str, tenant_id: str | None) -> None:
    from utils.db import SyncSessionLocal
    params = {"ai_id": agent_internal_id, "a_id": agent_id, "tid": tenant_id or None}
    with SyncSessionLocal() as session:
        session.execute(text(_REFRESH_DELETE_SQL), params)
        session.execute(text(_REFRESH_INSERT_SQL), {"ai_id": agent_internal_id, "tid": tenant_id or None})
        session.commit()


# ── Phase 2: Risk queue (BackgroundTask) ──────────────────────────────────────

async def _run_risk_assessments(agents: list[dict]) -> None:
    semaphore = asyncio.Semaphore(RISK_CONCURRENCY)

    async def assess_one(agent: dict) -> None:
        agent_id   = agent["agent_id"]
        agent_name = agent.get("agent_name", "")
        safe_name        = agent_name or agent_id
        safe_description = agent.get("description", "").strip() or f"AI agent: {safe_name}"

        payload = {
            "agent_internal_id": agent["agent_internal_id"],
            "agent_id":          agent_id,
            "agent_name":        safe_name,
            "agent_description": safe_description,
            "agent_instructions":agent.get("instruction", ""),
            "agent_role":        agent.get("role", ""),
            "provider":          "Connector",
            "agent_platform":    agent.get("platform", ""),
            "tenant_id":         agent.get("tenant_id"),
            "attack_vector_av": "N", "attack_complexity_ac": "L",
            "attack_requirements_at": "P", "privileges_required_pr": "L",
            "user_interaction_ui": "P",
            "vulnerable_system_confidentiality_vc": "L",
            "vulnerable_system_integrity_vi": "L",
            "vulnerable_system_availability_va": "L",
            "subsequent_system_confidentiality_sc": "L",
            "subsequent_system_integrity_si": "L",
            "subsequent_system_availability_sa": "L",
        }
        async with semaphore:
            try:
                async with httpx.AsyncClient(timeout=RISK_TIMEOUT_S) as client:
                    resp = await client.post(RISK_URL, json=payload)
                status = "completed" if resp.status_code == 200 else f"HTTP {resp.status_code}"
                print(f"[risk] {agent_id} ({agent_name}): {status}")
            except Exception as exc:
                print(f"[risk] {agent_id} ({agent_name}): error — {exc}")

    print(f"[risk] Background queue started — {len(agents)} agent(s), max {RISK_CONCURRENCY} concurrent")
    await asyncio.gather(*[assess_one(a) for a in agents], return_exceptions=True)
    print(f"[risk] Background queue complete")


# ── Phase 1: Extraction ───────────────────────────────────────────────────────

def _run_extraction(module_path: str, class_name: str, config: dict, admin_tenant_id: str | None = None) -> dict:
    buf              = io.StringIO()
    agents_extracted: list[dict] = []

    with _connector_lock:
        try:
            import worker
        except ImportError as exc:
            return {"status": "error", "error": f"worker module not available: {exc}"}

        card_dir = Path(AGENT_CARD_DIR)
        if card_dir.exists() and not card_dir.is_dir():
            card_dir = Path("/tmp/agent_cards")
        card_dir.mkdir(parents=True, exist_ok=True)

        original_dispatch = worker.dispatch_to_api_async

        def _save_and_collect(agent_internal_id: str, card_dict: dict) -> bool:
            ident      = card_dict.get("identification", {})
            agent_id   = ident.get("agent_id") or agent_internal_id or "unknown"
            # Admin's tenant_id takes precedence — agents extracted via the admin portal
            # belong to the admin's organization.
            tenant_id  = admin_tenant_id or ident.get("tenant_id") or None
            agent_name = card_dict.get("name", "") or agent_id

            filename = f"{agent_id}_agent_card.json"
            try:
                with open(card_dir / filename, "w", encoding="utf-8") as fh:
                    json.dump(card_dict, fh, indent=2)
                print(f"  Saved {filename}")
            except Exception as e:
                print(f"  WARNING: could not save {filename}: {e}")

            try:
                _refresh_agent_360_sync(agent_internal_id, agent_id, tenant_id)
                print(f"  curated.agent_360 refreshed for {agent_id}")
            except Exception as e:
                print(f"  WARNING: agent_360 refresh failed for {agent_id}: {e}")

            agents_extracted.append({
                "filename": filename, "agent_id": agent_id, "agent_name": agent_name,
                "agent_internal_id": agent_internal_id,
                "description": card_dict.get("description", ""),
                "instruction": ident.get("instruction", ""),
                "role":        ident.get("role", ""),
                "tenant_id":   tenant_id,
                "platform":    card_dict.get("provider", {}).get("organization", ""),
            })
            return True

        worker.dispatch_to_api_async = _save_and_collect
        try:
            mod = importlib.import_module(module_path)
            cls = getattr(mod, class_name)
            connector = cls(config)
            with redirect_stdout(buf):
                worker.init_pool()
                connector.execute()
        except Exception as exc:
            worker.dispatch_to_api_async = original_dispatch
            return {"status": "error", "error": str(exc)}
        finally:
            worker.dispatch_to_api_async = original_dispatch

    return {"status": "success", "count": len(agents_extracted), "agents_extracted": agents_extracted}


# ── Endpoints ─────────────────────────────────────────────────────────────────

class ConnectorRunRequest(BaseModel):
    config: dict


class GeminiAuthRequest(BaseModel):
    client_id: str
    client_secret: str
    auth_uri: str = "https://accounts.google.com/o/oauth2/auth"
    token_uri: str = "https://oauth2.googleapis.com/token"


# Every table in the core/curated/raw/risk_management schemas that has both
# a tenant_id column and an agent_internal_id column.
_AGENT_TABLES = [
    "core.agents",
    "core.agent_ai_models",
    "core.agent_ai_use_cases",
    "core.agent_business_applications",
    "core.agent_business_processes",
    "core.agent_configurations",
    "core.agent_controls",
    "core.agent_data_sources",
    "core.agent_governance_events",
    "core.agent_guardrails",
    "core.agent_identifications",
    "core.agent_knowledge_sources",
    "core.agent_llm_models",
    "core.agent_mcp_servers",
    "core.agent_memories",
    "core.agent_physical_ai",
    "core.agent_prompt_templates",
    "core.agent_regulations_or_frameworks",
    "core.agent_risk_assessments",
    "core.agent_tools",
    "core.ai_use_cases",
    "curated.agent_360",
    "raw.agent_card_json",
    "risk_management.agent_risk_assessment",
]


async def _stamp_tenant_id(agents_extracted: list[dict], tenant_id: str) -> None:
    """Stamp tenant_id on every related table for all extracted agents.

    Uses one UPDATE per table with an IN clause over the extracted agent_internal_ids.
    This runs after extraction regardless of how the connector created the records.
    """
    if not agents_extracted or not tenant_id:
        return

    ai_ids = [a["agent_internal_id"] for a in agents_extracted]
    # Build named placeholders: :id_0, :id_1, ...
    placeholders = ", ".join(f":id_{i}" for i in range(len(ai_ids)))
    id_params = {f"id_{i}": ai_id for i, ai_id in enumerate(ai_ids)}

    try:
        async with AsyncSessionLocal() as db:
            for table in _AGENT_TABLES:
                sql = f"UPDATE {table} SET tenant_id = :tid WHERE agent_internal_id IN ({placeholders})"
                await db.execute(text(sql), {"tid": tenant_id, **id_params})
            await db.commit()
        print(f"[connector] stamped tenant_id={tenant_id!r} across {len(_AGENT_TABLES)} tables for {len(ai_ids)} agent(s)", flush=True)
    except Exception as exc:
        print(f"[connector] tenant_id stamp failed: {exc}", flush=True)

    # Re-run curated.agent_360 refresh to pick up the new tenant_id
    for agent in agents_extracted:
        try:
            await asyncio.to_thread(
                _refresh_agent_360_sync,
                agent["agent_internal_id"],
                agent["agent_id"],
                tenant_id,
            )
        except Exception as exc:
            print(f"[connector] agent_360 refresh failed for {agent['agent_id']}: {exc}", flush=True)


async def _resolve_tenant_id(request: Request) -> str | None:
    """Get tenant_id from x-tenant-id header, or fall back to ZITADEL userinfo."""
    tid = request.headers.get("x-tenant-id") or None
    if tid:
        print(f"[connector] tenant_id from header: {tid!r}", flush=True)
        return tid

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        print("[connector] no tenant header and no bearer token — tenant_id will be NULL", flush=True)
        return None

    token = auth_header[len("Bearer "):]
    try:
        req_headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
        if _ZITADEL_INTERNAL_HOST:
            req_headers["Host"] = _ZITADEL_INTERNAL_HOST
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{_ZITADEL_INTERNAL_URL}/oidc/v1/userinfo", headers=req_headers)
        if resp.is_success:
            claims = resp.json()
            print(f"[connector] userinfo claims keys: {list(claims.keys())}", flush=True)
            tid = _extract_tenant_id(claims)
            print(f"[connector] tenant_id from userinfo: {tid!r}", flush=True)
            return tid
        print(f"[connector] userinfo call failed: HTTP {resp.status_code}", flush=True)
    except Exception as exc:
        print(f"[connector] tenant_id lookup error: {exc}", flush=True)
    return None


@router.post("/connectors/{connector_id}/run")
async def run_connector(connector_id: str, body: ConnectorRunRequest, background_tasks: BackgroundTasks, request: Request):
    if connector_id not in CONNECTOR_MAP:
        raise HTTPException(status_code=404, detail=f"Connector '{connector_id}' not found")

    admin_tenant_id = await _resolve_tenant_id(request)

    module_path, class_name = CONNECTOR_MAP[connector_id]
    result = await asyncio.to_thread(_run_extraction, module_path, class_name, body.config, admin_tenant_id)

    if result["status"] == "success" and result.get("agents_extracted"):
        if admin_tenant_id:
            await _stamp_tenant_id(result["agents_extracted"], admin_tenant_id)

        background_tasks.add_task(_run_risk_assessments, result["agents_extracted"])
        result["risk_queued"] = len(result["agents_extracted"])

    return result


@router.post("/connectors/gemini/auth-url")
async def gemini_auth_url(body: GeminiAuthRequest):
    scopes = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/dialogflow"]
    params = {"client_id": body.client_id, "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
              "response_type": "code", "scope": " ".join(scopes), "access_type": "offline", "prompt": "consent"}
    return {"auth_url": f"{body.auth_uri}?{urllib.parse.urlencode(params)}"}
