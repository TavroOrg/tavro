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
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from api.dependencies.auth import require_portal_admin

router = APIRouter()

AGENT_CARD_DIR   = os.getenv("AGENT_CARD_DIR",    "/app/agent_cards")
RISK_URL         = os.getenv("RISK_CLASSIFY_URL",  "http://tavro-api:8000/api/v1/risk/classify-risk")
RISK_CONCURRENCY = int(os.getenv("RISK_CONCURRENCY", "2"))
RISK_TIMEOUT_S   = int(os.getenv("RISK_TIMEOUT_S",   "600"))

CONNECTOR_MAP: dict[str, tuple[str, str]] = {
    "copilot":       ("catalog_connector.connector.copilot_connector",       "CopilotConnector"),
    "bedrock":       ("catalog_connector.connector.bedrock_connector",        "BedrockConnector"),
    "salesforce":    ("catalog_connector.connector.salesforce_connector",     "SalesforceConnector"),
    "servicenow":    ("catalog_connector.connector.servicenow_connector",     "ServiceNowConnector"),
    "snowflake":     ("catalog_connector.connector.snowflake_connector",      "SnowflakeConnector"),
    "databricks":    ("catalog_connector.connector.databricks_connector",     "DatabricksConnector"),
    "gemini":        ("catalog_connector.connector.gemini_connector",         "GeminiConnector"),
    "github":        ("catalog_connector.connector.mcp_connector.github_connector", "GitHubConnector"),
    "aict_inbound":  ("catalog_connector.connector.aict_inbound_connector",  "AICTInboundConnector"),
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

def _run_extraction(
    module_path: str, class_name: str, config: dict,
    admin_tenant_id: str | None = None,
    company_id: str | None = None,
    company_name: str | None = None,
) -> dict:
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

        # Override worker.process_card with a closure that injects tenant/company
        # so every card processed gets them written at INSERT time.
        original_process_card = worker.process_card

        def _process_card_with_context(card_dict: dict) -> None:
            return original_process_card(
                card_dict,
                tenant_id=admin_tenant_id,
                company_id=company_id,
                company_name=company_name,
            )

        worker.process_card = _process_card_with_context
        original_dispatch = worker.dispatch_to_api_async

        def _save_and_collect(agent_internal_id: str, card_dict: dict) -> bool:
            ident      = card_dict.get("identification", {})
            agent_id   = ident.get("agent_id") or agent_internal_id or "unknown"
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
            return {"status": "error", "error": str(exc)}
        finally:
            worker.process_card          = original_process_card
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




@router.post("/connectors/{connector_id}/run")
async def run_connector(
    connector_id: str,
    body: ConnectorRunRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    auth: dict = Depends(require_portal_admin),
):
    if connector_id not in CONNECTOR_MAP:
        raise HTTPException(status_code=404, detail=f"Connector '{connector_id}' not found")

    # Priority: x-tenant-id header (sent from localStorage) → ZITADEL userinfo claim
    admin_tenant_id: str | None = (
        request.headers.get("x-tenant-id", "").strip() or
        auth.get("tenant_id") or
        None
    )
    if not admin_tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve your organisation ID. "
                   "Set TAVRO_ADMIN_TENANT_ID in the environment, or ensure ZITADEL "
                   "includes org claims (urn:zitadel:iam:user:resourceowner) in its userinfo response.",
        )

    company_id   = request.headers.get("x-company-id",   "") or None
    company_name = request.headers.get("x-company-name", "") or None

    if not company_id:
        raise HTTPException(status_code=400, detail="No company selected. Select a company in the Admin Portal before running a connector.")

    module_path, class_name = CONNECTOR_MAP[connector_id]
    result = await asyncio.to_thread(
        _run_extraction, module_path, class_name, body.config,
        admin_tenant_id, company_id, company_name or "",
    )

    if result["status"] == "success" and result.get("agents_extracted"):
        background_tasks.add_task(_run_risk_assessments, result["agents_extracted"])
        result["risk_queued"] = len(result["agents_extracted"])

    return result


@router.post("/connectors/gemini/auth-url")
async def gemini_auth_url(body: GeminiAuthRequest):
    scopes = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/dialogflow"]
    params = {"client_id": body.client_id, "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
              "response_type": "code", "scope": " ".join(scopes), "access_type": "offline", "prompt": "consent"}
    return {"auth_url": f"{body.auth_uri}?{urllib.parse.urlencode(params)}"}
