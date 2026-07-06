"""
AICT Outbound Connector — pushes Tavro agents to ServiceNow AI Control Tower.

Used by:
  - Admin portal (connection test via AICTOutboundConnector.execute())
  - Temporal activities / API routers (create_ai_system / is_configured)
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import requests

from .base_connector import BaseConnector

logger = logging.getLogger(__name__)

_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}

AICT_MODEL_CATEGORY_SYS_ID = "5383f164ffec2a10c0fbffffffffff82"


def _aict_enabled() -> bool:
    """Read AICT_ENABLED from the .env file so toggle takes effect without restart."""
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
    return os.getenv("AICT_ENABLED", "true").strip().lower() not in ("false", "0", "no")


def is_configured() -> bool:
    if not _aict_enabled():
        return False
    return bool(
        os.getenv("SERVICENOW_INSTANCE_URL", "").strip() and
        os.getenv("SERVICENOW_USERNAME", "").strip() and
        os.getenv("SERVICENOW_PASSWORD", "").strip()
    )


def _instance_url() -> str:
    return os.getenv("SERVICENOW_INSTANCE_URL", "").rstrip("/")


def _auth() -> tuple:
    return (os.getenv("SERVICENOW_USERNAME", ""), os.getenv("SERVICENOW_PASSWORD", ""))


def _get(table: str, query: str, fields: str, limit: int = 1) -> list:
    resp = requests.get(
        f"{_instance_url()}/api/now/table/{table}",
        auth=_auth(),
        headers=_HEADERS,
        params={"sysparm_query": query, "sysparm_fields": fields, "sysparm_limit": limit, "sysparm_display_value": "false"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("result", [])


def _post(table: str, payload: dict) -> dict:
    resp = requests.post(f"{_instance_url()}/api/now/table/{table}", auth=_auth(), headers=_HEADERS, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json().get("result", {})


def _find_or_create_provider(provider_name: str) -> str:
    rows = _get("core_company", query=f"name={provider_name}", fields="sys_id,name")
    if rows:
        logger.info("AICT provider found: %s (%s)", provider_name, rows[0]["sys_id"])
        return rows[0]["sys_id"]
    result = _post("core_company", {"name": provider_name})
    logger.info("AICT provider created: %s (%s)", provider_name, result["sys_id"])
    return result["sys_id"]


def _find_or_create_model(name: str, description: str, provider_sys_id: str) -> str:
    rows = _get(
        "cmdb_ai_system_component_product_model",
        query=f"name={name}^manufacturer={provider_sys_id}^cmdb_model_category={AICT_MODEL_CATEGORY_SYS_ID}",
        fields="sys_id,name",
    )
    if rows:
        logger.info("AICT model found: %s (%s)", name, rows[0]["sys_id"])
        return rows[0]["sys_id"]
    result = _post("cmdb_ai_system_component_product_model", {
        "name": name, "manufacturer": provider_sys_id,
        "cmdb_model_category": AICT_MODEL_CATEGORY_SYS_ID, "description": description,
    })
    logger.info("AICT model created: %s (%s)", name, result["sys_id"])
    return result["sys_id"]


def _find_or_create_asset(name: str, description: str, model_sys_id: str, provider_sys_id: str) -> str:
    rows = _get("alm_ai_system_digital_asset", query=f"model={model_sys_id}", fields="sys_id,name,install_status")
    if rows:
        logger.info("AICT asset found: %s (%s)", name, rows[0]["sys_id"])
        return rows[0]["sys_id"]
    result = _post("alm_ai_system_digital_asset", {
        "name": name, "model": model_sys_id, "model_category": AICT_MODEL_CATEGORY_SYS_ID,
        "manufacturer": provider_sys_id, "description": description, "install_status": "1",
    })
    logger.info("AICT asset created: %s (%s)", name, result["sys_id"])
    return result["sys_id"]


def create_ai_system(agent_name: str, agent_description: str, provider_name: str = None) -> dict:
    """
    Find-or-create an AI System in ServiceNow AICT for the given Tavro agent.
    Raises RuntimeError if AICT is not configured.
    """
    if not is_configured():
        raise RuntimeError(
            "AICT integration is not configured. "
            "Set SERVICENOW_INSTANCE_URL, SERVICENOW_USERNAME, SERVICENOW_PASSWORD and enable AICT Sync."
        )
    resolved_provider = provider_name or os.getenv("AICT_PROVIDER_NAME", "Tavro")
    provider_sys_id   = _find_or_create_provider(resolved_provider)
    model_sys_id      = _find_or_create_model(agent_name, agent_description, provider_sys_id)
    asset_sys_id      = _find_or_create_asset(agent_name, agent_description, model_sys_id, provider_sys_id)
    return {"provider_sys_id": provider_sys_id, "model_sys_id": model_sys_id, "asset_sys_id": asset_sys_id}


class AICTOutboundConnector(BaseConnector):

    def __init__(self, config: dict):
        self.config        = config
        enabled_raw        = (config.get("enabled") or "true").strip().lower()
        self.enabled       = enabled_raw not in ("false", "0", "no")
        self.provider_name = (config.get("provider_name") or "").strip()
        self.instance_url  = os.getenv("SERVICENOW_INSTANCE_URL", "").rstrip("/")
        self.username      = os.getenv("SERVICENOW_USERNAME", "")
        self.password      = os.getenv("SERVICENOW_PASSWORD", "")

    def validate_config(self):
        if not self.enabled:
            raise ValueError("AICT outbound sync is disabled. Enable it in the connector settings.")
        if not self.provider_name:
            raise ValueError("Provider name is required for AICT outbound sync.")
        missing = [k for k, v in {"instance_url": self.instance_url, "username": self.username, "password": self.password}.items() if not v]
        if missing:
            raise ValueError(f"Missing ServiceNow credentials: {', '.join(missing)}. Save them in the shared credentials section.")

    def authenticate(self):
        pass

    def execute(self):
        print("Running AICT Outbound Connector — connection test")
        self.validate_config()
        resp = requests.get(
            f"{self.instance_url}/api/now/table/core_company",
            auth=(self.username, self.password),
            headers=_HEADERS,
            params={"sysparm_query": f"name={self.provider_name}", "sysparm_fields": "sys_id,name", "sysparm_limit": 1, "sysparm_display_value": "false"},
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json().get("result", [])
        if rows:
            print(f"AICT provider '{self.provider_name}' found (sys_id={rows[0]['sys_id']}). Outbound sync is ready.")
        else:
            print(f"AICT provider '{self.provider_name}' not found — it will be created automatically on first agent sync.")
        print("AICT outbound connection test completed successfully.")
