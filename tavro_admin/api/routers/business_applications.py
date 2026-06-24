"""
Business integrations endpoints — Business Applications and Business Processes.

POST /api/v1/admin/integrations/business-applications/run
  Fetches x_ydllc_tavro_comp_applications from ServiceNow → core.business_applications.

POST /api/v1/admin/integrations/business-processes/run
  Fetches x_ydllc_tavro_comp_process from ServiceNow → core.business_processes.

Both share the same ServiceNow credentials (.env vars) as the servicenow connector.
sys_id from ServiceNow is used as the stable primary ID for both tables.
User-reference fields (owner, stakeholders, etc.) are resolved to display names
via the sys_user API using the same credentials.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.dependencies.auth import require_portal_admin

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_float(val) -> float | None:
    try:
        return float(val) if val not in ("", None) else None
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int | None:
    try:
        return int(val) if val not in ("", None) else None
    except (ValueError, TypeError):
        return None


def _str(val) -> str:
    if val is None:
        return ""
    if isinstance(val, dict):
        return val.get("display_value") or val.get("value") or ""
    return str(val)


def _is_user_ref(val) -> bool:
    """Return True if the value is a ServiceNow sys_user reference dict."""
    return isinstance(val, dict) and "/sys_user/" in val.get("link", "")


def _resolve_user(val, instance_url: str, username: str, password: str, cache: dict[str, str]) -> str:
    """
    If val is a sys_user reference dict, fetch the user's display name from
    ServiceNow and cache it. Falls back to the sys_id (or empty string) on error.
    If val is a plain string, return it as-is.
    """
    if not _is_user_ref(val):
        return _str(val)

    user_id = val.get("value", "")
    if not user_id:
        return ""

    if user_id in cache:
        return cache[user_id]

    url = f"{instance_url.rstrip('/')}/api/now/table/sys_user/{user_id}"
    try:
        resp = httpx.get(
            url,
            auth=(username, password),
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        if resp.status_code == 200:
            result = resp.json().get("result", {})
            name = result.get("name") or result.get("user_name") or user_id
        else:
            name = user_id
    except Exception:
        name = user_id

    cache[user_id] = name
    return name


def _fetch_sn_table(instance_url: str, username: str, password: str, table: str) -> list[dict]:
    url = f"{instance_url.rstrip('/')}/api/now/table/{table}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    resp = httpx.get(url, auth=(username, password), headers=headers, timeout=60.0)
    if resp.status_code != 200:
        raise ValueError(f"ServiceNow returned HTTP {resp.status_code}: {resp.text[:500]}")
    return resp.json().get("result", [])


def _sn_credentials() -> tuple[str, str, str]:
    instance_url = os.getenv("SERVICENOW_INSTANCE_URL", "").strip()
    username     = os.getenv("SERVICENOW_USERNAME",     "").strip()
    password     = os.getenv("SERVICENOW_PASSWORD",     "").strip()
    if not instance_url or not username or not password:
        raise HTTPException(
            status_code=400,
            detail=(
                "ServiceNow credentials not configured. "
                "Set them in the Connectors → ServiceNow section first."
            ),
        )
    return instance_url, username, password


# ── Business Applications ─────────────────────────────────────────────────────

_BA_TABLE = "x_ydllc_tavro_comp_applications"

_BA_INSERT_SQL = """
INSERT INTO core.business_applications (
    tenant_id, business_application_id, application_name,
    emergency_tier, business_owner, application_portfolio_manager,
    vendor_name, business_criticality, it_application_owner,
    application_description, agent_risk_exposure, num_of_associated_agents,
    inherent_risk_classification, residual_risk_classification,
    agent_risk_tier, blended_risk_score,
    inherent_risk_classification_score, residual_risk_classification_score,
    embedded_ai, opt_out_option, privacy_policy_url,
    data_excluded_from_ai_training, vendor_description,
    current_installed_version, is_current_version_supported,
    latest_released_version, latest_release_date,
    latest_release_documentation_link,
    company_id, company_name,
    created_ts, updated_ts
) VALUES (
    :tenant_id, :business_application_id, :application_name,
    :emergency_tier, :business_owner, :application_portfolio_manager,
    :vendor_name, :business_criticality, :it_application_owner,
    :application_description, :agent_risk_exposure, :num_of_associated_agents,
    :inherent_risk_classification, :residual_risk_classification,
    :agent_risk_tier, :blended_risk_score,
    :inherent_risk_classification_score, :residual_risk_classification_score,
    :embedded_ai, :opt_out_option, :privacy_policy_url,
    :data_excluded_from_ai_training, :vendor_description,
    :current_installed_version, :is_current_version_supported,
    :latest_released_version, :latest_release_date,
    :latest_release_documentation_link,
    :company_id, :company_name,
    :created_ts, :updated_ts
)
ON CONFLICT (tenant_id, company_id, business_application_id) DO UPDATE SET
    application_name                   = EXCLUDED.application_name,
    emergency_tier                     = EXCLUDED.emergency_tier,
    business_owner                     = EXCLUDED.business_owner,
    application_portfolio_manager      = EXCLUDED.application_portfolio_manager,
    vendor_name                        = EXCLUDED.vendor_name,
    business_criticality               = EXCLUDED.business_criticality,
    it_application_owner               = EXCLUDED.it_application_owner,
    application_description            = EXCLUDED.application_description,
    agent_risk_exposure                = EXCLUDED.agent_risk_exposure,
    num_of_associated_agents           = EXCLUDED.num_of_associated_agents,
    inherent_risk_classification       = EXCLUDED.inherent_risk_classification,
    residual_risk_classification       = EXCLUDED.residual_risk_classification,
    agent_risk_tier                    = EXCLUDED.agent_risk_tier,
    blended_risk_score                 = EXCLUDED.blended_risk_score,
    inherent_risk_classification_score = EXCLUDED.inherent_risk_classification_score,
    residual_risk_classification_score = EXCLUDED.residual_risk_classification_score,
    embedded_ai                        = EXCLUDED.embedded_ai,
    opt_out_option                     = EXCLUDED.opt_out_option,
    privacy_policy_url                 = EXCLUDED.privacy_policy_url,
    data_excluded_from_ai_training     = EXCLUDED.data_excluded_from_ai_training,
    vendor_description                 = EXCLUDED.vendor_description,
    current_installed_version          = EXCLUDED.current_installed_version,
    is_current_version_supported       = EXCLUDED.is_current_version_supported,
    latest_released_version            = EXCLUDED.latest_released_version,
    latest_release_date                = EXCLUDED.latest_release_date,
    latest_release_documentation_link  = EXCLUDED.latest_release_documentation_link,
    company_name                       = EXCLUDED.company_name,
    updated_ts                         = EXCLUDED.updated_ts
"""

# User-reference fields in the business applications SN table
_BA_USER_FIELDS = ["business_owner", "application_portfolio_manager", "it_application_owner"]


def _fetch_and_map_ba(
    instance_url: str, username: str, password: str, tenant_id: str | None,
    company_id: str | None = None, company_name: str | None = None,
) -> list[dict]:
    records = _fetch_sn_table(instance_url, username, password, _BA_TABLE)
    user_cache: dict[str, str] = {}
    now = datetime.utcnow()
    rows = []
    for record in records:
        # Resolve user-reference fields to display names before mapping
        resolved: dict = {}
        for field in _BA_USER_FIELDS:
            resolved[field] = _resolve_user(record.get(field), instance_url, username, password, user_cache)

        rows.append({
            "tenant_id":                          tenant_id,
            "business_application_id":            _str(record.get("sys_id")),
            "application_name":                   _str(record.get("name")),
            "emergency_tier":                     _str(record.get("emergency_tier")),
            "business_owner":                     resolved["business_owner"],
            "application_portfolio_manager":      resolved["application_portfolio_manager"],
            "vendor_name":                        _str(record.get("vendor_name")),
            "business_criticality":               _str(record.get("business_criticality")),
            "it_application_owner":               resolved["it_application_owner"],
            "application_description":            _str(record.get("application_description")),
            "agent_risk_exposure":                _safe_float(record.get("are")),
            "num_of_associated_agents":           _safe_int(record.get("associated_agents")),
            "inherent_risk_classification":       _str(record.get("inherent_risk_classification")),
            "residual_risk_classification":       _str(record.get("residual_risk_classification")),
            "agent_risk_tier":                    _str(record.get("agent_risk_tier")),
            "blended_risk_score":                 _safe_float(record.get("blended_risk_score")),
            "inherent_risk_classification_score": _safe_float(record.get("inherent_risk_classification_score")),
            "residual_risk_classification_score": _safe_float(record.get("residual_risk_classification_score")),
            "embedded_ai":                        _str(record.get("embededd_ai")),
            "opt_out_option":                     _str(record.get("opt_out_option")),
            "privacy_policy_url":                 _str(record.get("privacy_policy_url")),
            "data_excluded_from_ai_training":     _str(record.get("data_specifically_excluded_from_ai_training")),
            "vendor_description":                 _str(record.get("vendor_description")),
            "current_installed_version":          _str(record.get("current_installed_version")),
            "is_current_version_supported":       _str(record.get("is_current_installed_version_supported")),
            "latest_released_version":            _str(record.get("latest_released_version")),
            "latest_release_date":                _str(record.get("latest_release_date")),
            "latest_release_documentation_link":  _str(record.get("latest_release_documentation_link")),
            "company_id":                         company_id,
            "company_name":                       company_name,
            "created_ts":                         now,
            "updated_ts":                         now,
        })

    print(f"[business-apps] resolved users via cache ({len(user_cache)} unique)", flush=True)
    return rows


@router.post("/integrations/business-applications/run")
async def run_business_applications(
    request: Request,
    auth: dict = Depends(require_portal_admin),
):
    tenant_id: str | None = (
        request.headers.get("x-tenant-id", "").strip() or
        auth.get("tenant_id") or
        None
    )
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve your organisation ID. "
                   "Set TAVRO_ADMIN_TENANT_ID in the environment, or ensure ZITADEL "
                   "includes org claims in its userinfo response.",
        )

    company_id   = request.headers.get("x-company-id",   "") or None
    company_name = request.headers.get("x-company-name", "") or None

    if not company_id:
        raise HTTPException(status_code=400, detail="No company selected. Select a company in the Admin Portal before running.")

    instance_url, username, password = _sn_credentials()

    try:
        rows = await asyncio.to_thread(_fetch_and_map_ba, instance_url, username, password, tenant_id, company_id, company_name)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from ServiceNow: {exc}")

    async with AsyncSessionLocal() as db:
        for row in rows:
            await db.execute(text(_BA_INSERT_SQL), row)
        await db.commit()

    print(f"[business-apps] stored {len(rows)} application(s) for tenant_id={tenant_id!r} company_id={company_id!r}", flush=True)

    return {
        "status": "success",
        "count": len(rows),
        "applications": [
            {"name": r["application_name"], "business_application_id": r["business_application_id"]}
            for r in rows
        ],
    }


# ── Business Processes ────────────────────────────────────────────────────────

_BP_TABLE = "x_ydllc_tavro_comp_process"

_BP_INSERT_SQL = """
INSERT INTO core.business_processes (
    tenant_id, business_process_id, process_number, process_name,
    process_description, parent_process_id, owner, stakeholders, operators,
    business_criticality, reputational_impact, num_of_associated_agents,
    agent_risk_tier, residual_risk_classification, inherent_risk_classification,
    financial_impact, regulatory_impact,
    agent_risk_exposure, blended_risk_score,
    residual_risk_classification_score, inherent_risk_classification_score,
    sla, process_health_state,
    company_id, company_name,
    created_ts, updated_ts
) VALUES (
    :tenant_id, :business_process_id, :process_number, :process_name,
    :process_description, :parent_process_id, :owner, :stakeholders, :operators,
    :business_criticality, :reputational_impact, :num_of_associated_agents,
    :agent_risk_tier, :residual_risk_classification, :inherent_risk_classification,
    :financial_impact, :regulatory_impact,
    :agent_risk_exposure, :blended_risk_score,
    :residual_risk_classification_score, :inherent_risk_classification_score,
    :sla, :process_health_state,
    :company_id, :company_name,
    :created_ts, :updated_ts
)
ON CONFLICT (tenant_id, company_id, business_process_id) DO UPDATE SET
    process_number                     = EXCLUDED.process_number,
    process_name                       = EXCLUDED.process_name,
    process_description                = EXCLUDED.process_description,
    parent_process_id                  = EXCLUDED.parent_process_id,
    owner                              = EXCLUDED.owner,
    stakeholders                       = EXCLUDED.stakeholders,
    operators                          = EXCLUDED.operators,
    business_criticality               = EXCLUDED.business_criticality,
    reputational_impact                = EXCLUDED.reputational_impact,
    num_of_associated_agents           = EXCLUDED.num_of_associated_agents,
    agent_risk_tier                    = EXCLUDED.agent_risk_tier,
    residual_risk_classification       = EXCLUDED.residual_risk_classification,
    inherent_risk_classification       = EXCLUDED.inherent_risk_classification,
    financial_impact                   = EXCLUDED.financial_impact,
    regulatory_impact                  = EXCLUDED.regulatory_impact,
    agent_risk_exposure                = EXCLUDED.agent_risk_exposure,
    blended_risk_score                 = EXCLUDED.blended_risk_score,
    residual_risk_classification_score = EXCLUDED.residual_risk_classification_score,
    inherent_risk_classification_score = EXCLUDED.inherent_risk_classification_score,
    sla                                = EXCLUDED.sla,
    process_health_state               = EXCLUDED.process_health_state,
    company_name                       = EXCLUDED.company_name,
    updated_ts                         = EXCLUDED.updated_ts
"""

# User-reference fields in the business processes SN table
_BP_USER_FIELDS = ["owner", "stakeholders", "operators"]


def _fetch_and_map_bp(
    instance_url: str, username: str, password: str, tenant_id: str | None,
    company_id: str | None = None, company_name: str | None = None,
) -> list[dict]:
    records = _fetch_sn_table(instance_url, username, password, _BP_TABLE)
    user_cache: dict[str, str] = {}
    now = datetime.utcnow()
    rows = []
    for record in records:
        resolved: dict = {}
        for field in _BP_USER_FIELDS:
            resolved[field] = _resolve_user(record.get(field), instance_url, username, password, user_cache)

        rows.append({
            "tenant_id":                          tenant_id,
            "business_process_id":                _str(record.get("sys_id")),
            "process_number":                     _str(record.get("number")),
            "process_name":                       _str(record.get("process_name")),
            "process_description":                _str(record.get("process_description")),
            # Must be NULL (not "") when absent — FK constraint
            "parent_process_id":                  _str(record.get("parent_process_id")) or None,
            "owner":                              resolved["owner"],
            "stakeholders":                       resolved["stakeholders"],
            "operators":                          resolved["operators"],
            "business_criticality":               _str(record.get("business_criticality")),
            "reputational_impact":                _str(record.get("reputational_impact")),
            "num_of_associated_agents":           _safe_int(record.get("associated_agents")),
            "agent_risk_tier":                    _str(record.get("agent_risk_tier")),
            "residual_risk_classification":       _str(record.get("residual_risk_classification")),
            "inherent_risk_classification":       _str(record.get("inherent_risk_classification")),
            "financial_impact":                   _str(record.get("financial_impact")),
            "regulatory_impact":                  _str(record.get("regulatory_impact")),
            "agent_risk_exposure":                _safe_float(record.get("agent_risk_exposure")),
            "blended_risk_score":                 _safe_float(record.get("blended_risk_score")),
            "residual_risk_classification_score": _safe_float(record.get("residual_risk_classification_score")),
            "inherent_risk_classification_score": _safe_float(record.get("inherent_risk_classification_score")),
            "sla":                                _str(record.get("sla")),
            "process_health_state":               _str(record.get("process_health_state")),
            "company_id":                         company_id,
            "company_name":                       company_name,
            "created_ts":                         now,
            "updated_ts":                         now,
        })

    # Insert parents before children so the FK constraint is satisfied
    rows.sort(key=lambda r: 0 if r["parent_process_id"] is None else 1)

    print(f"[business-procs] resolved users via cache ({len(user_cache)} unique)", flush=True)
    return rows


@router.post("/integrations/business-processes/run")
async def run_business_processes(
    request: Request,
    auth: dict = Depends(require_portal_admin),
):
    tenant_id: str | None = (
        request.headers.get("x-tenant-id", "").strip() or
        auth.get("tenant_id") or
        None
    )
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve your organisation ID. "
                   "Set TAVRO_ADMIN_TENANT_ID in the environment, or ensure ZITADEL "
                   "includes org claims in its userinfo response.",
        )

    company_id   = request.headers.get("x-company-id",   "") or None
    company_name = request.headers.get("x-company-name", "") or None

    if not company_id:
        raise HTTPException(status_code=400, detail="No company selected. Select a company in the Admin Portal before running.")

    instance_url, username, password = _sn_credentials()

    try:
        rows = await asyncio.to_thread(_fetch_and_map_bp, instance_url, username, password, tenant_id, company_id, company_name)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from ServiceNow: {exc}")

    async with AsyncSessionLocal() as db:
        for row in rows:
            await db.execute(text(_BP_INSERT_SQL), row)
        await db.commit()

    print(f"[business-procs] stored {len(rows)} process(es) for tenant_id={tenant_id!r} company_id={company_id!r}", flush=True)

    return {
        "status": "success",
        "count": len(rows),
        "processes": [
            {"name": r["process_name"], "business_process_id": r["business_process_id"]}
            for r in rows
        ],
    }
