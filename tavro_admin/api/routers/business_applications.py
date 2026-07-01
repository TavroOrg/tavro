"""
Business integrations endpoints — Business Applications and Business Processes.

POST /api/v1/admin/integrations/business-applications/run
  Fetches cmdb_ci_business_app from ServiceNow → core.business_applications.

POST /api/v1/admin/integrations/business-processes/run
  Fetches cmdb_ci_business_process from ServiceNow → core.business_processes.

Both share the same ServiceNow credentials (.env vars) as the servicenow connector.
sys_id from ServiceNow is used as the stable primary ID for both tables.
sysparm_display_value=true is used so reference fields return display names inline.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, date

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text

from api.database import AsyncSessionLocal
from api.dependencies.auth import require_portal_admin

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _str(val) -> str:
    if val is None:
        return ""
    if isinstance(val, dict):
        return val.get("display_value") or val.get("value") or ""
    return str(val)


def _date(val) -> date | None:
    """Return a date object or None — never an empty string."""
    raw = _str(val).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None



def _fetch_sn_table(instance_url: str, username: str, password: str, table: str, display_value: bool = False) -> list[dict]:
    url = f"{instance_url.rstrip('/')}/api/now/table/{table}"
    params = {"sysparm_display_value": "true"} if display_value else {}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    resp = httpx.get(url, auth=(username, password), headers=headers, params=params, timeout=60.0)
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

_BA_TABLE = "cmdb_ci_business_app"

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


def _fetch_and_map_ba(
    instance_url: str, username: str, password: str, tenant_id: str | None,
    company_id: str | None = None, company_name: str | None = None,
) -> list[dict]:
    print(f"[business-apps] fetching from {instance_url.rstrip('/')}/api/now/table/{_BA_TABLE}", flush=True)
    records = _fetch_sn_table(instance_url, username, password, _BA_TABLE, display_value=True)
    print(f"[business-apps] fetched {len(records)} record(s), mapping fields", flush=True)
    now = datetime.utcnow()
    rows = []
    for record in records:
        # With sysparm_display_value=true, all reference fields come back as
        # display name strings — no extra API calls needed per record.
        rows.append({
            "tenant_id":                          tenant_id,
            "business_application_id":            _str(record.get("sys_id")),
            "application_name":                   _str(record.get("name")),
            "emergency_tier":                     _str(record.get("emergency_tier")),
            "business_owner":                     _str(record.get("owned_by")),
            "application_portfolio_manager":      _str(record.get("application_manager")),
            "vendor_name":                        _str(record.get("vendor")),
            "business_criticality":               _str(record.get("business_criticality")),
            "it_application_owner":               _str(record.get("it_application_owner")),
            "application_description":            _str(record.get("short_description")),
            "agent_risk_exposure":                None,
            "num_of_associated_agents":           None,
            "inherent_risk_classification":       "",
            "residual_risk_classification":       "",
            "agent_risk_tier":                    "",
            "blended_risk_score":                 None,
            "inherent_risk_classification_score": None,
            "residual_risk_classification_score": None,
            "embedded_ai":                        _str(record.get("u_ai_capability_enabled")),
            "opt_out_option":                     _str(record.get("u_is_an_ai_opt_out_option_available")),
            "privacy_policy_url":                 _str(record.get("u_privacy_policy_url")),
            "data_excluded_from_ai_training":     _str(record.get("u_data_specifically_excluded_from_ai_training_yes_no")),
            "vendor_description":                 "",
            "current_installed_version":          _str(record.get("u_current_installed_version")),
            "is_current_version_supported":       _str(record.get("u_is_current_installed_version_supported")),
            "latest_released_version":            _str(record.get("u_latest_released_version")),
            "latest_release_date":                _date(record.get("u_latest_release_date")),
            "latest_release_documentation_link":  _str(record.get("u_latest_release_documentation_link")),
            "company_id":                         company_id,
            "company_name":                       company_name,
            "created_ts":                         now,
            "updated_ts":                         now,
        })

    print(f"[business-apps] mapped {len(rows)} record(s)", flush=True)
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

_BP_TABLE = "cmdb_ci_business_process"

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

def _fetch_and_map_bp(
    instance_url: str, username: str, password: str, tenant_id: str | None,
    company_id: str | None = None, company_name: str | None = None,
) -> list[dict]:
    print(f"[business-procs] fetching from {instance_url.rstrip('/')}/api/now/table/{_BP_TABLE}", flush=True)
    records = _fetch_sn_table(instance_url, username, password, _BP_TABLE, display_value=True)
    print(f"[business-procs] fetched {len(records)} record(s), mapping fields", flush=True)
    now = datetime.utcnow()
    rows = []
    for record in records:
        # With sysparm_display_value=true, all reference fields come back as
        # display name strings — no extra API calls needed per record.
        rows.append({
            "tenant_id":                          tenant_id,
            "business_process_id":                _str(record.get("sys_id")),
            "process_number":                     "",
            "process_name":                       _str(record.get("name")),
            "process_description":                _str(record.get("short_description")),
            "parent_process_id":                  None,
            "owner":                              _str(record.get("owned_by")),
            "stakeholders":                       "",
            "operators":                          "",
            "business_criticality":               _str(record.get("business_crit_declared")),
            "reputational_impact":                "",
            "num_of_associated_agents":           None,
            "agent_risk_tier":                    "",
            "residual_risk_classification":       "",
            "inherent_risk_classification":       "",
            "financial_impact":                   "",
            "regulatory_impact":                  "",
            "agent_risk_exposure":                None,
            "blended_risk_score":                 None,
            "residual_risk_classification_score": None,
            "inherent_risk_classification_score": None,
            "sla":                                "",
            "process_health_state":               _str(record.get("operational_status")),
            "company_id":                         company_id,
            "company_name":                       company_name,
            "created_ts":                         now,
            "updated_ts":                         now,
        })

    print(f"[business-procs] mapped {len(rows)} record(s)", flush=True)
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
