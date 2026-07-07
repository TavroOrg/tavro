"""
Lightweight AICT outbound sync helpers — safe to import in any container.

This module has no dependency on worker or other catalog connectors.
The full AICTOutboundConnector class (for admin portal) lives in
catalog_connector/connector/aict_outbound_connector.py.
"""
import logging
import os
import re
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}
AICT_MODEL_CATEGORY_SYS_ID = "5383f164ffec2a10c0fbffffffffff82"


def _aict_enabled() -> bool:
    env_file = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
    try:
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                m = re.match(r'^AICT_ENABLED\s*=\s*(.*)', stripped)
                if m:
                    val = m.group(1).strip().strip('"').strip("'")
                    return val.lower() not in ("false", "0", "no")
    except Exception:
        pass
    return os.getenv("AICT_ENABLED", "false").strip().lower() not in ("false", "0", "no")


def is_configured() -> bool:
    if not _aict_enabled():
        return False
    return bool(
        os.getenv("SERVICENOW_INSTANCE_URL", "").strip() and
        os.getenv("SERVICENOW_USERNAME", "").strip() and
        os.getenv("SERVICENOW_PASSWORD", "").strip()
    )


def _url(table: str) -> str:
    return f"{os.getenv('SERVICENOW_INSTANCE_URL', '').rstrip('/')}/api/now/table/{table}"

def _auth() -> tuple:
    return (os.getenv("SERVICENOW_USERNAME", ""), os.getenv("SERVICENOW_PASSWORD", ""))


def _get(table: str, query: str, fields: str) -> list:
    resp = requests.get(_url(table), auth=_auth(), headers=_HEADERS,
                        params={"sysparm_query": query, "sysparm_fields": fields,
                                "sysparm_limit": 1, "sysparm_display_value": "false"}, timeout=30)
    resp.raise_for_status()
    return resp.json().get("result", [])


def _post(table: str, payload: dict) -> dict:
    resp = requests.post(_url(table), auth=_auth(), headers=_HEADERS, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json().get("result", {})


def _find_or_create_provider(name: str) -> str:
    rows = _get("core_company", f"name={name}", "sys_id,name")
    if rows:
        return rows[0]["sys_id"]
    return _post("core_company", {"name": name})["sys_id"]


def _find_or_create_model(name: str, description: str, provider_sys_id: str) -> str:
    rows = _get("cmdb_ai_system_component_product_model",
                f"name={name}^manufacturer={provider_sys_id}^cmdb_model_category={AICT_MODEL_CATEGORY_SYS_ID}",
                "sys_id,name")
    if rows:
        return rows[0]["sys_id"]
    return _post("cmdb_ai_system_component_product_model", {
        "name": name, "manufacturer": provider_sys_id,
        "cmdb_model_category": AICT_MODEL_CATEGORY_SYS_ID, "description": description,
    })["sys_id"]


def _find_or_create_asset(name: str, description: str, model_sys_id: str, provider_sys_id: str) -> str:
    rows = _get("alm_ai_system_digital_asset", f"model={model_sys_id}", "sys_id,name,install_status")
    if rows:
        return rows[0]["sys_id"]
    return _post("alm_ai_system_digital_asset", {
        "name": name, "model": model_sys_id, "model_category": AICT_MODEL_CATEGORY_SYS_ID,
        "manufacturer": provider_sys_id, "description": description, "install_status": "1",
    })["sys_id"]


def sync_agent(agent_name: str, agent_description: str, provider_name: str = None) -> None:
    """
    Sync a single agent to AICT. No-ops silently if AICT is not configured or disabled.
    Safe to call from anywhere — never raises.
    """
    if not is_configured():
        return
    try:
        create_ai_system(agent_name, agent_description, provider_name)
    except Exception as e:
        logger.warning("AICT outbound sync failed for agent '%s': %s", agent_name, e)


def create_ai_system(agent_name: str, agent_description: str, provider_name: str = None) -> dict:
    """Find-or-create an AI System in ServiceNow AICT for a Tavro agent."""
    if not is_configured():
        raise RuntimeError(
            "AICT integration is not configured. "
            "Set SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, SERVICENOW_PASSWORD and enable AICT Sync."
        )
    provider      = provider_name or "Tavro"
    provider_id   = _find_or_create_provider(provider)
    model_id      = _find_or_create_model(agent_name, agent_description, provider_id)
    asset_id      = _find_or_create_asset(agent_name, agent_description, model_id, provider_id)
    return {"provider_sys_id": provider_id, "model_sys_id": model_id, "asset_sys_id": asset_id}
