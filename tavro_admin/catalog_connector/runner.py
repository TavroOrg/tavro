"""
runner.py — dispatcher between the FastAPI route and the individual connector classes.

The FastAPI endpoint calls run_connector(name, config) with whatever credentials
the admin user entered in the UI. runner.py picks the right connector class,
instantiates it, calls execute(), captures stdout, and returns a result dict.

Each connector's execute() calls save_agent_cards() (or save_mcp_card() for GitHub)
which writes JSON files to extracted_json/<connector_name>/.

Import note: connectors must be imported as catalog_connector.connector.xxx so that
their relative imports (from ..transformers) resolve correctly within the package.
PYTHONPATH must include both '/' (so catalog_connector is importable as a package)
and '/catalog_connector' (so 'from save import' and 'from utils.auth import' work).
"""

import io
import os
from contextlib import redirect_stdout
from pathlib import Path

_EXTRACTED_DIR = Path(__file__).parent / "extracted_json"


def run_connector(connector_name: str, config: dict) -> dict:
    stdout_buf = io.StringIO()

    try:
        connector = _build_connector(connector_name, config)
        before = _snapshot(connector_name)

        with redirect_stdout(stdout_buf):
            connector.execute()

        after = _snapshot(connector_name)
        new_files = sorted(after - before)
        logs = stdout_buf.getvalue()

        return {
            "status": "success",
            "connector": connector_name,
            "files_saved": new_files,
            "count": len(new_files),
            "logs": logs,
        }

    except Exception as exc:
        logs = stdout_buf.getvalue()
        return {
            "status": "error",
            "connector": connector_name,
            "error": str(exc),
            "logs": logs,
        }


def _snapshot(connector_name: str) -> set:
    d = _EXTRACTED_DIR / connector_name
    if not d.exists():
        return set()
    return {f.name for f in d.glob("*.json")}


def _build_connector(name: str, config: dict):
    # Import via full catalog_connector.connector.xxx path so that the
    # relative imports inside each connector (e.g. from ..transformers import ...)
    # resolve correctly within the catalog_connector package hierarchy.
    if name == "copilot":
        from catalog_connector.connector.copilot_connector import CopilotConnector
        return CopilotConnector(config)

    if name == "bedrock":
        from catalog_connector.connector.bedrock_connector import BedrockConnector
        return BedrockConnector(config)

    if name == "salesforce":
        from catalog_connector.connector.salesforce_connector import SalesforceConnector
        return SalesforceConnector(config)

    if name == "servicenow":
        from catalog_connector.connector.servicenow_connector import ServiceNowConnector
        return ServiceNowConnector(config)

    if name == "snowflake":
        from catalog_connector.connector.snowflake_connector import SnowflakeConnector
        return SnowflakeConnector(config)

    if name == "databricks":
        from catalog_connector.connector.databricks_connector import DatabricksConnector
        return DatabricksConnector(config)

    if name == "gemini":
        from catalog_connector.connector.gemini_connector import GeminiConnector
        # authenticate() now handles service_account_json, access_token, and interactive flow
        return GeminiConnector(config)

    if name == "github":
        from catalog_connector.connector.mcp_connector.github_connector import GithubConnector
        return GithubConnector(config)

    if name == "agent365":
        from catalog_connector.connector.agent365_inbound_connector import Agent365InboundConnector
        return Agent365InboundConnector(config)

    raise ValueError(f"Unknown connector: {name}")
