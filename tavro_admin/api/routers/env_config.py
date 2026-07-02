"""
Connector credential management via the project .env file.

GET  /connectors/{id}/credentials  — reads current values from .env
POST /connectors/{id}/credentials  — writes updated values back to .env
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ENV_FILE_PATH = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
_ENV_LOCK = threading.Lock()

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
    "agent365": {
    "tenant_id":     "AGENT365_TENANT_ID",
    "client_id":     "AGENT365_CLIENT_ID",
    "client_secret": "AGENT365_CLIENT_SECRET",
    "num_agents":    "AGENT365_NUM_AGENTS",
    },
    "aict_inbound": {
        "instance_url": "SERVICENOW_INSTANCE_URL",
        "username":     "SERVICENOW_USERNAME",
        "password":     "SERVICENOW_PASSWORD",
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
    """Update specific variables in .env, preserving all other content.
    Holds a process-level lock so concurrent saves never interleave reads and writes."""
    with _ENV_LOCK:
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


# Maps infrastructure item field keys -> .env variable names
INFRASTRUCTURE_ENV_MAP: dict[str, dict[str, str]] = {
    "general-config": {
        # Database
        "postgres_user":                               "POSTGRES_USER",
        "postgres_password":                           "POSTGRES_PASSWORD",
        "database_url":                                "DATABASE_URL",
        # Application
        "build_mode":                                  "BUILD_MODE",
        # CrewAI
        "crewai_llm_model":                            "CREWAI_LLM_MODEL",
        "crewai_max_tokens":                           "CREWAI_MAX_TOKENS",
        "crewai_txt_search_embedder":                  "CREWAI_TXT_SEARCH_EMBEDDER",
        "otel_sdk_disabled":                           "OTEL_SDK_DISABLED",
        "crewai_disable_telemetry":                    "CREWAI_DISABLE_TELEMETRY",
        "crewai_tracing_enabled":                      "CREWAI_TRACING_ENABLED",
        # Database Schemas
        "core_db_name":                                "CORE_DB_NAME",
        "curated_db_name":                             "CURATED_DB_NAME",
        "risk_management_db_name":                     "RISK_MANAGEMENT_DB_NAME",
        # Zitadel / Auth
        "tavro_public_origin":                         "TAVRO_PUBLIC_ORIGIN",
        "vite_zitadel_issuer":                         "VITE_ZITADEL_ISSUER",
        "vite_zitadel_client_id":                      "VITE_ZITADEL_CLIENT_ID",
        "vite_zitadel_redirect_path":                  "VITE_ZITADEL_REDIRECT_PATH",
        "vite_zitadel_scope":                          "VITE_ZITADEL_SCOPE",
        "vite_mcp_url":                                "VITE_MCP_URL",
        "zitadel_project_name":                        "ZITADEL_PROJECT_NAME",
        "zitadel_app_name":                            "ZITADEL_APP_NAME",
        "zitadel_app_redirect_uris":                   "ZITADEL_APP_REDIRECT_URIS",
        "zitadel_app_post_logout_redirect_uris":       "ZITADEL_APP_POST_LOGOUT_REDIRECT_URIS",
        # Zitadel Configuration
        "zitadel_domain":                              "ZITADEL_DOMAIN",
        "proxy_http_published_port":                   "PROXY_HTTP_PUBLISHED_PORT",
        "zitadel_externalport":                        "ZITADEL_EXTERNALPORT",
        "zitadel_externalsecure":                      "ZITADEL_EXTERNALSECURE",
        "zitadel_public_scheme":                       "ZITADEL_PUBLIC_SCHEME",
        "zitadel_masterkey":                           "ZITADEL_MASTERKEY",
        "login_client_pat_expiration":                 "LOGIN_CLIENT_PAT_EXPIRATION",
        "zitadel_admin_pat_expiration":                "ZITADEL_ADMIN_PAT_EXPIRATION",
        # Image Tags
        "zitadel_version":                             "ZITADEL_VERSION",
        "traefik_image":                               "TRAEFIK_IMAGE",
        "postgres_image":                              "POSTGRES_IMAGE",
        "redis_image":                                 "REDIS_IMAGE",
        "otel_collector_image":                        "OTEL_COLLECTOR_IMAGE",
        # Proxy
        "traefik_dashboard_enabled":                   "TRAEFIK_DASHBOARD_ENABLED",
        "traefik_log_level":                           "TRAEFIK_LOG_LEVEL",
        "traefik_accesslog_enabled":                   "TRAEFIK_ACCESSLOG_ENABLED",
        "traefik_trusted_ips":                         "TRAEFIK_TRUSTED_IPS",
        "letsencrypt_email":                           "LETSENCRYPT_EMAIL",
        # Zitadel Caches
        "zitadel_access_log_stdout_enabled":           "ZITADEL_ACCESS_LOG_STDOUT_ENABLED",
        "zitadel_caches_redis_enabled":                "ZITADEL_CACHES_CONNECTORS_REDIS_ENABLED",
        "zitadel_caches_redis_url":                    "ZITADEL_CACHES_CONNECTORS_REDIS_URL",
        "zitadel_caches_instance_connector":           "ZITADEL_CACHES_INSTANCE_CONNECTOR",
        "zitadel_caches_milestones_connector":         "ZITADEL_CACHES_MILESTONES_CONNECTOR",
        "zitadel_caches_organization_connector":       "ZITADEL_CACHES_ORGANIZATION_CONNECTOR",
        # OTEL / Tracing
        "zitadel_instrumentation_servicename":         "ZITADEL_INSTRUMENTATION_SERVICENAME",
        "zitadel_instrumentation_trace_exporter_type": "ZITADEL_INSTRUMENTATION_TRACE_EXPORTER_TYPE",
        "zitadel_instrumentation_trace_exporter_ep":   "ZITADEL_INSTRUMENTATION_TRACE_EXPORTER_ENDPOINT",
        "zitadel_instrumentation_trace_exporter_insecure": "ZITADEL_INSTRUMENTATION_TRACE_EXPORTER_INSECURE",
        "login_otel_service_name":                     "LOGIN_OTEL_SERVICE_NAME",
        "login_otel_exporter_otlp_endpoint":           "LOGIN_OTEL_EXPORTER_OTLP_ENDPOINT",
        "login_otel_exporter_otlp_protocol":           "LOGIN_OTEL_EXPORTER_OTLP_PROTOCOL",
        # Internal URLs
        "risk_classify_url":                           "RISK_CLASSIFY_URL",
        "risk_classify_fallback_url":                  "RISK_CLASSIFY_FALLBACK_URL",
        "company_api_base_url":                        "COMPANY_API_BASE_URL",
        "tavro_api_url":                               "TAVRO_API_URL",
        "vite_copilot_api_url":                        "VITE_COPILOT_API_URL",
    },
    "oauth-jwt": {
        "github_client_id":     "GITHUB_CLIENT_ID",
        "github_client_secret": "GITHUB_CLIENT_SECRET",
        "jwt_signing_key":      "JWT_SIGNING_KEY",
    },
    "azure-foundry": {
        "az_foundry_endpoint":        "AZURE_AI_FOUNDRY_ENDPOINT",
        "az_foundry_key":             "AZURE_AI_FOUNDRY_KEY",
        "az_foundry_api_version":     "AZURE_AI_FOUNDRY_API_VERSION",
        "az_foundry_agent_api_ver":   "AZURE_AI_FOUNDRY_AGENT_API_VERSION",
        "az_foundry_deployment":      "AZURE_AI_FOUNDRY_DEPLOYMENT",
        "az_foundry_client_id":       "AZURE_AI_FOUNDRY_CLIENT_ID",
        "az_foundry_tenant_id":       "AZURE_AI_FOUNDRY_TENANT_ID",
        "az_foundry_client_secret":   "AZURE_AI_FOUNDRY_CLIENT_SECRET",
        "az_foundry_hosted_endpoint": "AZURE_AI_FOUNDRY_HOSTED_ENDPOINT",
    },
    "playground-bedrock": {
        "playground_bedrock_access_key": "PLAYGROUND_BEDROCK_ACCESS_KEY",
        "playground_bedrock_secret_key": "PLAYGROUND_BEDROCK_SECRET_KEY",
        "playground_bedrock_region":     "PLAYGROUND_BEDROCK_REGION",
    },
    "claude-cli": {
        "api_key":               "ANTHROPIC_API_KEY",
        "azure_hosted_endpoint": "AZURE_AI_FOUNDRY_HOSTED_ENDPOINT",
        "azure_client_id":       "AZURE_AI_FOUNDRY_CLIENT_ID",
        "azure_tenant_id":       "AZURE_AI_FOUNDRY_TENANT_ID",
        "azure_client_secret":   "AZURE_AI_FOUNDRY_CLIENT_SECRET",
        "git_repo_url":          "GIT_PUBLISH_REPO_URL",
        "git_token":             "GIT_PUBLISH_TOKEN",
        "git_branch":            "GIT_PUBLISH_BRANCH",
    },
}


@router.get("/infrastructure/{item_id}/credentials")
def get_infrastructure_credentials(item_id: str):
    mapping = INFRASTRUCTURE_ENV_MAP.get(item_id)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Infrastructure item '{item_id}' not found")
    env_vals = _read_env_file()
    return {field: env_vals.get(env_var, "") for field, env_var in mapping.items()}


@router.post("/infrastructure/{item_id}/credentials")
def save_infrastructure_credentials(item_id: str, body: CredentialSaveRequest):
    mapping = INFRASTRUCTURE_ENV_MAP.get(item_id)
    if not mapping:
        raise HTTPException(status_code=404, detail=f"Infrastructure item '{item_id}' not found")
    updates = {
        env_var: body.credentials[field]
        for field, env_var in mapping.items()
        if field in body.credentials
    }
    _update_env_file(updates)
    return {"status": "saved", "updated": list(updates.keys())}
