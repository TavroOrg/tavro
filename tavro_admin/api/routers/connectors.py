"""
Connector run endpoints — two-phase execution.

Phase 1 — Extraction (sync, runs in a thread)
  connector.execute() calls worker.process_card() for every agent.
  worker.dispatch_to_api_async is patched so the risk API is never called here.
  The patch instead:
    1. Saves the agent card JSON to AGENT_CARD_DIR.
    2. Refreshes curated.agent_360 so the agent is immediately visible in the portal.
    3. Collects the agent's metadata for Phase 2.

Phase 2 — Risk Assessment Queue (async, starts after all agents are extracted)
  asyncio.Semaphore(RISK_CONCURRENCY) enforces the concurrency cap (default 5).
  asyncio.gather(..., return_exceptions=True) ensures every agent is attempted
  regardless of individual failures — failures are isolated and logged only.
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
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

router = APIRouter()

AGENT_CARD_DIR   = os.getenv("AGENT_CARD_DIR",    "/app/agent_cards")
RISK_URL         = os.getenv("RISK_CLASSIFY_URL",  "http://tavro-api:8000/api/v1/risk/classify-risk")
RISK_CONCURRENCY = int(os.getenv("RISK_CONCURRENCY", "5"))

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

# Serialize connector runs: only one may patch worker at a time.
_connector_lock = threading.Lock()

# ── curated.agent_360 refresh SQL ─────────────────────────────────────────────

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
        COALESCE(t.tool_count,   0),
        COALESCE(ds.ds_count,    0),
        COALESCE(ap.app_count,   0),
        COALESCE(pr.proc_count,  0),
        COALESCE(mo.model_count, 0),
        pm.model_name, pm.model_provider,
        COALESCE(ds.has_pii, FALSE),
        COALESCE(ds.has_phi, FALSE),
        COALESCE(ds.has_pci, FALSE),
        NULL, NULL, NULL,       -- risk fields populated after assessment
        CURRENT_TIMESTAMP,
        a.agent_internal_id,
        NULL
    FROM core.agents a
    LEFT JOIN core.agent_configurations cfg
        ON  cfg.agent_internal_id = a.agent_internal_id
        AND COALESCE(cfg.is_current, TRUE) = TRUE
    LEFT JOIN (
        SELECT agent_internal_id, COUNT(*)::bigint AS tool_count
        FROM   core.agent_tools GROUP BY agent_internal_id
    ) t  ON t.agent_internal_id  = a.agent_internal_id
    LEFT JOIN (
        SELECT agent_internal_id,
               COUNT(*)::bigint                        AS ds_count,
               BOOL_OR(COALESCE(contains_pii, FALSE))  AS has_pii,
               BOOL_OR(COALESCE(contains_phi, FALSE))  AS has_phi,
               BOOL_OR(COALESCE(contains_pci, FALSE))  AS has_pci
        FROM   core.agent_data_sources GROUP BY agent_internal_id
    ) ds ON ds.agent_internal_id = a.agent_internal_id
    LEFT JOIN (
        SELECT agent_internal_id, COUNT(*)::bigint AS app_count
        FROM   core.agent_business_applications GROUP BY agent_internal_id
    ) ap ON ap.agent_internal_id = a.agent_internal_id
    LEFT JOIN (
        SELECT agent_internal_id, COUNT(*)::bigint AS proc_count
        FROM   core.agent_business_processes GROUP BY agent_internal_id
    ) pr ON pr.agent_internal_id = a.agent_internal_id
    LEFT JOIN (
        SELECT agent_internal_id, COUNT(*)::bigint AS model_count
        FROM   core.agent_ai_models GROUP BY agent_internal_id
    ) mo ON mo.agent_internal_id = a.agent_internal_id
    LEFT JOIN LATERAL (
        SELECT model_name, model_provider
        FROM   core.agent_ai_models m
        WHERE  m.agent_internal_id = a.agent_internal_id
        ORDER  BY COALESCE(m.is_primary_model, FALSE) DESC,
                  m.created_ts DESC NULLS LAST
        LIMIT  1
    ) pm ON TRUE
    WHERE a.agent_internal_id = :ai_id
      AND COALESCE(a.is_current, TRUE) = TRUE
      AND (:tid IS NULL OR a.tenant_id = :tid)
"""


def _refresh_agent_360_sync(agent_internal_id: str, agent_id: str, tenant_id: str | None) -> None:
    from utils.db import SyncSessionLocal
    params = {"ai_id": agent_internal_id, "a_id": agent_id, "tid": tenant_id or None}
    with SyncSessionLocal() as session:
        session.execute(text(_REFRESH_DELETE_SQL), params)
        session.execute(text(_REFRESH_INSERT_SQL), {"ai_id": agent_internal_id, "tid": tenant_id or None})
        session.commit()


# ── Phase 2: Risk Assessment Queue ────────────────────────────────────────────

async def _run_risk_assessments(agents: list[dict], risk_logs: list[str]) -> dict:
    """
    Runs risk assessments for every extracted agent with a sliding-window
    concurrency cap.  Each agent is independent — failures are isolated.
    """
    semaphore = asyncio.Semaphore(RISK_CONCURRENCY)
    queued = 0
    failed = 0
    # Thread-safe counters via a mutable container (tasks share the same list).
    counts = [0, 0]  # [queued, failed]

    async def assess_one(agent: dict) -> None:
        agent_id   = agent["agent_id"]
        agent_name = agent.get("agent_name", "")

        async with semaphore:   # blocks until a slot is free; releases on exit even if exc
            try:
                risk_logs.append(f"[risk] → Starting  {agent_id} ({agent_name})")

                payload = {
                    "agent_internal_id": agent["agent_internal_id"],
                    "agent_id":          agent_id,
                    "agent_name":        agent_name,
                    "agent_description": agent.get("description", ""),
                    "agent_instructions":agent.get("instruction", ""),
                    "agent_role":        agent.get("role", ""),
                    "provider":          "Connector",
                    "agent_platform":    agent.get("platform", ""),
                    "tenant_id":         agent.get("tenant_id"),
                    # CVSS defaults — user can re-run risk from the portal to override
                    "attack_vector_av":                     "N",
                    "attack_complexity_ac":                 "L",
                    "attack_requirements_at":               "P",
                    "privileges_required_pr":               "L",
                    "user_interaction_ui":                  "P",
                    "vulnerable_system_confidentiality_vc": "L",
                    "vulnerable_system_integrity_vi":       "L",
                    "vulnerable_system_availability_va":    "L",
                    "subsequent_system_confidentiality_sc": "L",
                    "subsequent_system_integrity_si":       "L",
                    "subsequent_system_availability_sa":    "L",
                }

                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(RISK_URL, json=payload)

                if resp.status_code == 200:
                    risk_logs.append(f"[risk] ✓ Queued    {agent_id}")
                    counts[0] += 1
                else:
                    risk_logs.append(
                        f"[risk] ✗ Failed    {agent_id}  HTTP {resp.status_code}: {resp.text[:200]}"
                    )
                    counts[1] += 1

            except Exception as exc:
                # Isolated failure — other agents continue unaffected.
                risk_logs.append(f"[risk] ✗ Error     {agent_id}: {exc}")
                counts[1] += 1

    risk_logs.append(
        f"[risk] Queue started — {len(agents)} agent(s), "
        f"concurrency limit: {RISK_CONCURRENCY}"
    )

    # Launch all tasks at once; semaphore keeps at most RISK_CONCURRENCY running.
    # return_exceptions=True prevents one task's failure from cancelling others.
    await asyncio.gather(*[assess_one(a) for a in agents], return_exceptions=True)

    risk_logs.append(
        f"[risk] Queue complete — "
        f"queued: {counts[0]}, failed: {counts[1]}, total: {len(agents)}"
    )
    return {"total": len(agents), "queued": counts[0], "failed": counts[1]}


# ── Phase 1: Connector extraction (sync, runs in a thread) ────────────────────

def _run_connector_sync(module_path: str, class_name: str, config: dict) -> dict:
    buf           = io.StringIO()
    files_saved:   list[str]  = []
    agents_to_assess: list[dict] = []   # populated by the patched dispatch

    with _connector_lock:
        try:
            import worker
        except ImportError as exc:
            return {"status": "error", "error": f"worker module not available: {exc}", "logs": ""}

        card_dir = Path(AGENT_CARD_DIR)
        if card_dir.exists() and not card_dir.is_dir():
            card_dir = Path("/tmp/agent_cards")
        card_dir.mkdir(parents=True, exist_ok=True)

        original_dispatch = worker.dispatch_to_api_async

        def _save_and_collect(agent_internal_id: str, card_dict: dict) -> bool:
            ident      = card_dict.get("identification", {})
            agent_id   = ident.get("agent_id") or agent_internal_id or "unknown"
            tenant_id  = ident.get("tenant_id") or None

            # ── 1. Save JSON file ──────────────────────────────────────────
            filename  = f"{agent_id}_agent_card.json"
            file_path = card_dir / filename
            try:
                with open(file_path, "w", encoding="utf-8") as fh:
                    json.dump(card_dict, fh, indent=2)
                files_saved.append(filename)
                print(f"  Saved {filename}")
            except Exception as write_err:
                print(f"  WARNING: could not save {filename}: {write_err}")

            # ── 2. Refresh curated.agent_360 (portal visibility) ──────────
            try:
                _refresh_agent_360_sync(agent_internal_id, agent_id, tenant_id)
                print(f"  curated.agent_360 refreshed for {agent_id}")
            except Exception as refresh_err:
                print(f"  WARNING: agent_360 refresh failed for {agent_id}: {refresh_err}")

            # ── 3. Collect for Phase 2 risk queue ─────────────────────────
            agents_to_assess.append({
                "agent_internal_id": agent_internal_id,
                "agent_id":          agent_id,
                "agent_name":        card_dict.get("name", ""),
                "description":       card_dict.get("description", ""),
                "instruction":       ident.get("instruction", ""),
                "role":              ident.get("role", ""),
                "tenant_id":         tenant_id,
                "platform":          card_dict.get("provider", {}).get("organization", ""),
            })

            return True  # tell worker the dispatch succeeded (risk API not called here)

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
            return {"status": "error", "error": str(exc), "logs": buf.getvalue()}
        finally:
            worker.dispatch_to_api_async = original_dispatch

    connector_logs = buf.getvalue()

    # ── Phase 2: Risk assessment queue ────────────────────────────────────────
    risk_summary = {"total": 0, "queued": 0, "failed": 0}
    risk_logs: list[str] = []

    if agents_to_assess:
        # asyncio.run() creates a fresh event loop in this worker thread —
        # safe because we are NOT on the main FastAPI event loop thread.
        risk_summary = asyncio.run(_run_risk_assessments(agents_to_assess, risk_logs))

    combined_logs = connector_logs
    if risk_logs:
        combined_logs += "\n" + "\n".join(risk_logs)

    return {
        "status":       "success",
        "logs":         combined_logs,
        "count":        len(files_saved),
        "files_saved":  files_saved,
        "risk_summary": risk_summary,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

class ConnectorRunRequest(BaseModel):
    config: dict


class GeminiAuthRequest(BaseModel):
    client_id: str
    client_secret: str
    auth_uri: str = "https://accounts.google.com/o/oauth2/auth"
    token_uri: str = "https://oauth2.googleapis.com/token"


@router.post("/connectors/{connector_id}/run")
async def run_connector(connector_id: str, body: ConnectorRunRequest):
    if connector_id not in CONNECTOR_MAP:
        raise HTTPException(status_code=404, detail=f"Connector '{connector_id}' not found")

    module_path, class_name = CONNECTOR_MAP[connector_id]
    return await asyncio.to_thread(_run_connector_sync, module_path, class_name, body.config)


@router.post("/connectors/gemini/auth-url")
async def gemini_auth_url(body: GeminiAuthRequest):
    scopes = [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/dialogflow",
    ]
    params = {
        "client_id":     body.client_id,
        "redirect_uri":  "urn:ietf:wg:oauth:2.0:oob",
        "response_type": "code",
        "scope":         " ".join(scopes),
        "access_type":   "offline",
        "prompt":        "consent",
    }
    return {"auth_url": f"{body.auth_uri}?{urllib.parse.urlencode(params)}"}
