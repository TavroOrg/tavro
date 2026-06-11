"""
Connector credential management via the project .env file.

GET  /connectors/{id}/credentials  — reads current values from .env
POST /connectors/{id}/credentials  — writes updated values back to .env
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ENV_FILE_PATH = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))

# Maps connector field keys → .env variable names
CONNECTOR_ENV_MAP: dict[str, dict[str, str]] = {
    "copilot": {
        "client_id":     "AZURE_CLIENT_ID",
        "client_secret": "AZURE_CLIENT_SECRET",
        "tenant_id":     "AZURE_TENANT_ID",
        "scope":         "AZURE_SCOPE",
        "org_url":       "AZURE_ORG_URL",
    },
    "bedrock": {
        "access_key": "BEDROCK_ACCESS_KEY",
        "secret_key": "BEDROCK_SECRET_KEY",
        "region":     "BEDROCK_REGION",
    },
    "salesforce": {
        "instance_url": "SALESFORCE_INSTANCE_URL",
        "api_version":  "SALESFORCE_API_VERSION",
        "access_token": "SALESFORCE_ACCESS_TOKEN",
    },
    "servicenow": {
        "instance_url": "SERVICENOW_INSTANCE_URL",
        "username":     "SERVICENOW_USERNAME",
        "password":     "SERVICENOW_PASSWORD",
    },
    "snowflake": {
        "account":  "SNOWFLAKE_ACCOUNT",
        "database": "SNOWFLAKE_DATABASE",
        "schema":   "SNOWFLAKE_SCHEMA",
        "token":    "SNOWFLAKE_TOKEN",
    },
    "databricks": {
        "workspace_url":    "DATABRICKS_WORKSPACE_URL",
        "databricks_token": "DATABRICKS_TOKEN",
    },
    "gemini": {
        "client_id":     "GEMINI_CLIENT_ID",
        "client_secret": "GEMINI_CLIENT_SECRET",
        "project_id":    "GEMINI_PROJECT_ID",
        "collection_id": "GEMINI_COLLECTION_ID",
        "engine_id":     "GEMINI_ENGINE_ID",
        "auth_uri":      "GEMINI_AUTH_URI",
        "token_uri":     "GEMINI_TOKEN_URI",
    },
    "github": {
        "base_url": "GITHUB_MCP_BASE_URL",
        "token":    "GITHUB_MCP_TOKEN",
    },
}


def _read_env_file() -> dict[str, str]:
    """Parse .env into key→value dict, stripping surrounding quotes."""
    if not ENV_FILE_PATH.exists():
        return {}
    result: dict[str, str] = {}
    for line in ENV_FILE_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)', stripped)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if (val.startswith('"') and val.endswith('"')) or \
           (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        result[key] = val
    return result


def _update_env_file(updates: dict[str, str]) -> None:
    """Update specific variables in .env, preserving all other content."""
    if not ENV_FILE_PATH.exists():
        raise HTTPException(status_code=500, detail=".env file not found — is it mounted into the container?")

    lines = ENV_FILE_PATH.read_text(encoding="utf-8").splitlines(keepends=True)
    updated: set[str] = set()
    new_lines: list[str] = []

    for line in lines:
        matched = False
        for var, value in updates.items():
            if re.match(rf'^{re.escape(var)}\s*=', line):
                new_lines.append(f"{var}={value}\n")
                updated.add(var)
                matched = True
                break
        if not matched:
            new_lines.append(line)

    # Append any vars that were not already in the file.
    # Ensure the file ends with a newline before appending so the new var
    # doesn't get concatenated onto the last existing line.
    remaining = [var for var in updates if var not in updated]
    if remaining:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        for var in remaining:
            new_lines.append(f"{var}={updates[var]}\n")

    ENV_FILE_PATH.write_text("".join(new_lines), encoding="utf-8")

    # Keep the running process in sync
    for var, value in updates.items():
        os.environ[var] = value


# Maps LLM provider keys → .env variable names
LLM_KEY_ENV_MAP: dict[str, dict[str, str]] = {
    "github_copilot": {
        "token": "GITHUB_COPILOT_TOKEN",
    },
    "openai": {
        "api_key": "OPENAI_API_KEY",
    },
    "azure_openai": {
        "base_url": "AZURE_AI_FOUNDRY_ENDPOINT",
        "api_key":  "AZURE_AI_FOUNDRY_KEY",
    },
    "anthropic": {
        "api_key": "ANTHROPIC_API_KEY",
    },
}


# ── Endpoints ──────────────────────────────────────────────────────────────────

class CredentialSaveRequest(BaseModel):
    credentials: dict[str, str]


@router.get("/llm-keys/{provider}")
def get_llm_key(provider: str):
    mapping = LLM_KEY_ENV_MAP.get(provider)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' not found")
    env_vals = _read_env_file()
    return {field: env_vals.get(env_var, "") for field, env_var in mapping.items()}


@router.post("/llm-keys/{provider}")
def save_llm_key(provider: str, body: CredentialSaveRequest):
    mapping = LLM_KEY_ENV_MAP.get(provider)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' not found")
    updates = {
        env_var: body.credentials[field]
        for field, env_var in mapping.items()
        if field in body.credentials
    }
    _update_env_file(updates)
    return {"status": "saved", "updated": list(updates.keys())}


@router.get("/connectors/{connector_id}/credentials")
def get_connector_credentials(connector_id: str):
    mapping = CONNECTOR_ENV_MAP.get(connector_id)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Connector '{connector_id}' not found")
    env_vals = _read_env_file()
    return {field: env_vals.get(env_var, "") for field, env_var in mapping.items()}


@router.post("/connectors/{connector_id}/credentials")
def save_connector_credentials(connector_id: str, body: CredentialSaveRequest):
    mapping = CONNECTOR_ENV_MAP.get(connector_id)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Connector '{connector_id}' not found")
    updates = {
        env_var: body.credentials[field]
        for field, env_var in mapping.items()
        if field in body.credentials
    }
    _update_env_file(updates)
    return {"status": "saved", "updated": list(updates.keys())}
