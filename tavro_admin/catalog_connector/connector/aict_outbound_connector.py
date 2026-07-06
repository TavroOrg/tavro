"""
AICT Outbound Connector — validates the connection to ServiceNow AI Control Tower
and confirms the provider (manufacturer) record exists or can be created.

Uses the shared ServiceNow credentials (SERVICENOW_INSTANCE_URL etc.) already
stored in the environment from the shared credentials section.

Run via the Admin Portal to verify AICT connectivity before enabling outbound sync.
"""
from __future__ import annotations

import logging
import os

import requests

from catalog_connector.connector.base_connector import BaseConnector

logger = logging.getLogger(__name__)

_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}


class AICTOutboundConnector(BaseConnector):

    def __init__(self, config: dict):
        self.config = config
        enabled_raw = (config.get("enabled") or "true").strip().lower()
        self.enabled = enabled_raw not in ("false", "0", "no")
        self.provider_name = (config.get("provider_name") or "").strip()
        # Shared ServiceNow credentials are already persisted in the environment
        self.instance_url = os.getenv("SERVICENOW_INSTANCE_URL", "").rstrip("/")
        self.username     = os.getenv("SERVICENOW_USERNAME", "")
        self.password     = os.getenv("SERVICENOW_PASSWORD", "")

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

        auth = (self.username, self.password)
        url  = f"{self.instance_url}/api/now/table/core_company"
        resp = requests.get(
            url,
            auth=auth,
            headers=_HEADERS,
            params={
                "sysparm_query":         f"name={self.provider_name}",
                "sysparm_fields":        "sys_id,name",
                "sysparm_limit":         1,
                "sysparm_display_value": "false",
            },
            timeout=30,
        )
        resp.raise_for_status()

        rows = resp.json().get("result", [])
        if rows:
            sys_id = rows[0]["sys_id"]
            print(f"AICT provider '{self.provider_name}' found (sys_id={sys_id}). Outbound sync is ready.")
        else:
            print(f"AICT provider '{self.provider_name}' not found — it will be created automatically on first agent sync.")

        print("AICT outbound connection test completed successfully.")
