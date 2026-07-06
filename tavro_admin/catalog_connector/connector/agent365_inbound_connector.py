from __future__ import annotations

import asyncio
import hashlib
import os
import random
import uuid
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import threading

import requests
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.dependencies.auth import require_portal_admin
from catalog_connector.connector.base_connector import BaseConnector
from catalog_connector.transformers.agent_transformer import transform_to_agent_cards

router = APIRouter(prefix="/api/v1/agent365", tags=["Agent365 Inbound"])

CORE            = os.getenv("CORE_DB_NAME", "core")
_WEBHOOK_SECRET = os.getenv("AGENT365_WEBHOOK_SECRET", "")
_TOKEN_URL      = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

# Scope for delegated access — uses Graph (already registered on the app).
# With a real admin user token, /copilot/admin/catalog/packages works even
# when app-only tokens are blocked (license / policy reasons).
_GRAPH_DELEGATED_SCOPE = "https://graph.microsoft.com/.default offline_access"

# Official Graph Package Management API (requires Microsoft Agent 365 license)
_CATALOG_V1   = "https://graph.microsoft.com/v1.0/copilot/admin/catalog/packages"
_CATALOG_BETA = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _env_value(*keys: str) -> str:
    """
    Read the freshest value from .env first, then fall back to process env.
    The admin portal updates .env at runtime, while tavro-api may already be
    running with older os.environ values.
    """
    file_values: Dict[str, str] = {}
    for env_file in _env_files():
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, val = stripped.split("=", 1)
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            file_values[key.strip()] = val

    for key in keys:
        value = file_values.get(key)
        if value:
            os.environ[key] = value
            return value.strip()
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


def _creds() -> Tuple[str, str, str]:
    t = _env_value("AGENT365_TENANT_ID", "AZURE_TENANT_ID")
    c = _env_value("AGENT365_CLIENT_ID", "AZURE_CLIENT_ID")
    s = _env_value("AGENT365_CLIENT_SECRET", "AZURE_CLIENT_SECRET")
    return t, c, s


# ---------------------------------------------------------------------------
# SOURCE 1 — Microsoft Graph Package Management API (delegated user token)
# GET https://graph.microsoft.com/beta/copilot/admin/catalog/packages
# Requires a delegated token obtained via Device Code Flow.
# Token is refreshed automatically using AGENT365_REFRESH_TOKEN.
# ---------------------------------------------------------------------------

_ENV_FILE = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
_env_lock = threading.Lock()


def _env_files() -> List[Path]:
    files = [_ENV_FILE]
    local_env = Path(".env")
    if local_env not in files:
        files.append(local_env)
    return files

async def _fetch_m365_agents(
    tenant_id: str,
    client_id: str,
):
    """
    Fetch all agents exclusively via the Microsoft Graph Package Management API:
    GET https://graph.microsoft.com/beta/copilot/admin/catalog/packages
    Ref: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/overview
    Requires a delegated token obtained via Device Code Flow (AGENT365_REFRESH_TOKEN).
    """
    logs = []

    refresh_present = bool(_env_value("AGENT365_REFRESH_TOKEN"))
    print(f"[m365] refresh_token present in env: {refresh_present}")
    graph_token = await _get_delegated_token(tenant_id, client_id)
    print(f"[m365] delegated token obtained: {bool(graph_token)}")
    if not graph_token:
        msg = (
            "catalog/packages: no delegated token available — "
            "complete Device Code sign-in in the Agent 365 connector first"
        )
        print(f"[m365] {msg}")
        logs.append(msg)
        return [], logs

    headers = {"Authorization": f"Bearer {graph_token}"}
    packages = []

    def _safe_json(r: httpx.Response) -> Any:
        try:
            return r.json()
        except Exception:
            return {}

    # Fetch all packages, then client-side filter to those that support Copilot.
    # The admin center "All agents" view shows packages whose supportedHosts or
    # elementTypes indicate Copilot capability (Title IDs with P_ prefix in the
    # admin center correspond to catalog packages).
    # OData server-side filters on supportedHosts/elementTypes return 0 for this
    # tenant, so we pull all packages and filter locally.
    all_packages: list = []
    async with httpx.AsyncClient(timeout=60) as client:
        url: Optional[str] = (
            "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"
        )
        while url:
            resp = await client.get(url, headers=headers)
            print(f"[m365] catalog/packages -> {resp.status_code}  raw={resp.text[:200]}")
            if resp.status_code == 403:
                err_msg = _safe_json(resp).get("error", {}).get("message", resp.text[:200])
                msg = (
                    f"catalog/packages: 403 — {err_msg}. "
                    "Ensure the app registration has CopilotPackages.Read.All (or .ReadWrite.All) "
                    "delegated permission and the signed-in user is a Global Admin."
                )
                print(f"[m365] {msg}")
                logs.append(msg)
                break
            if resp.status_code != 200:
                msg = f"catalog/packages -> {resp.status_code}: {resp.text[:300]}"
                print(f"[m365] {msg}")
                logs.append(msg)
                break
            data = _safe_json(resp)
            batch = data.get("value", [])
            if not all_packages and batch:
                print(f"[m365] FIRST ITEM SAMPLE: {batch[0]}")
            print(f"[m365] page: {len(batch)} items (total so far: {len(all_packages) + len(batch)})")
            all_packages.extend(batch)
            print(f"Total packages from Graph: {len(all_packages)}")
            url = data.get("@odata.nextLink")

    # Log a sample of the first package to reveal available fields
    if all_packages:
        print(f"[m365] FULL FIELD SAMPLE (first pkg): {all_packages[0]}")

    # Collect all unique field keys and unique elementTypes/supportedHosts values
    # across ALL packages so we can identify discriminating fields for the filter.
    all_elem_types: set = set()
    all_host_values: set = set()
    for p in all_packages:
        for et in (p.get("elementTypes") or []):
            all_elem_types.add(str(et))
        for h in (p.get("supportedHosts") or []):
            all_host_values.add(str(h))
    print(f"[m365] ALL elementTypes seen: {sorted(all_elem_types)}")
    print(f"[m365] ALL supportedHosts seen: {sorted(all_host_values)}")

    # ---------------------------------------------------------------------------
    # Filter to packages that appear in the admin center "All agents" view.
    #
    # Known agent categories:
    #   T_-prefixed IDs  → Copilot Studio / Foundry agents (always include)
    #   P_-prefixed IDs  → ISV / Microsoft first-party catalog agents
    #       Include when elementTypes contains an agent-like type (copilotAgent,
    #       agent, declarativeAgent, customCopilot, plugin, apiPlugin) OR when
    #       supportedHosts contains 'Copilot' and elementTypes has no
    #       non-agent types that would indicate a plain Teams app.
    # ---------------------------------------------------------------------------

    _AGENT_ELEM_TYPES = {
        "copilotagent", "agent", "declarativeagent", "declarativecopilots",
        "customcopilot", "agentskills", "agentconnectors",
    }

    def _is_copilot_agent(pkg: dict) -> bool:
        pkg_id = str(pkg.get("id", ""))
        if pkg_id.startswith("T_"):
            return True
        elem_types = {str(e).lower() for e in (pkg.get("elementTypes") or [])}
        if elem_types & _AGENT_ELEM_TYPES:
            return True
        hosts = {str(h).lower() for h in (pkg.get("supportedHosts") or [])}
        return "copilot" in hosts or "microsoftcopilot" in hosts

    packages = [p for p in all_packages if _is_copilot_agent(p)]

    t_count = sum(1 for p in packages if str(p.get("id", "")).startswith("T_"))
    p_count = len(packages) - t_count
    print(f"[m365] after copilot-agent filter: {len(packages)} of {len(all_packages)} total (T_={t_count}, P_={p_count})")

    # ── Enrich every agent with its detail record (concurrent, max 10 in-flight) ──
    # The list endpoint omits customActions (tools) for most agents.
    # GET /packages/{id} returns the full manifest with tool definitions.
    #
    # NOTE: "capabilities" and "extensions" are NOT included here — Copilot Studio
    # agents always have a capabilities array (e.g. ["Actions", "Topics"]) in the
    # list response.  Treating those as "already has tool data" would prevent us from
    # fetching the per-package detail that actually contains the tool definitions.
    _REAL_TOOL_FIELDS = {"customActions", "actions", "plugins", "tools"}
    _ALL_TOOL_FIELDS  = _REAL_TOOL_FIELDS | {"capabilities", "extensions", "elementDetails"}
    _DETAIL_BASE = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"
    _sem = asyncio.Semaphore(10)
    _detail_client = httpx.AsyncClient(timeout=30)

    async def _fetch_detail(pkg: dict) -> dict:
        pkg_id = str(pkg.get("id", ""))
        if not pkg_id:
            return pkg
        async with _sem:
            try:
                r = await _detail_client.get(f"{_DETAIL_BASE}/{pkg_id}", headers=headers)
                if r.status_code == 200:
                    detail = r.json()
                    # detail overrides list fields; preserve list fields not in detail
                    merged = {**pkg, **detail}

                    # ── Verbose logging for T_ (Copilot Studio / Foundry) agents ──
                    if pkg_id.startswith("T_"):
                        name_raw = pkg.get("displayName") or ""
                        ed = detail.get("elementDetails") or []
                        print(f"[T_AGENT_RAW] '{name_raw}' id={pkg_id}")
                        print(f"[T_AGENT_RAW]   top_keys={list(detail.keys())}")
                        print(f"[T_AGENT_RAW]   elementTypes={detail.get('elementTypes')}")
                        print(f"[T_AGENT_RAW]   capabilities={detail.get('capabilities')}")
                        print(f"[T_AGENT_RAW]   actions={json.dumps(detail.get('actions') or [])[:400]}")
                        print(f"[T_AGENT_RAW]   plugins={json.dumps(detail.get('plugins') or [])[:400]}")
                        print(f"[T_AGENT_RAW]   tools={json.dumps(detail.get('tools') or [])[:400]}")
                        print(f"[T_AGENT_RAW]   elementDetails count={len(ed)}")
                        for _ed in ed:
                            _et = _ed.get("elementType", "")
                            _elems = _ed.get("elements") or []
                            print(f"[T_AGENT_RAW]   elementType={_et}  elements={len(_elems)}")
                            for _el in _elems:
                                _def_raw = _el.get("definition", "")
                                try:
                                    _def_parsed = json.loads(_def_raw) if isinstance(_def_raw, str) else _def_raw
                                    _def_str = json.dumps(_def_parsed)[:2000]
                                except Exception:
                                    _def_str = str(_def_raw)[:2000]
                                print(f"[T_AGENT_RAW]     id={_el.get('id')} def={_def_str}")

                    tool_data = {k: detail[k] for k in _ALL_TOOL_FIELDS if detail.get(k)}
                    if tool_data:
                        name_raw = pkg.get("displayName") or ""
                        print(f"[m365] DETAIL TOOLS '{name_raw}' id={pkg_id}: keys={list(tool_data.keys())}")
                    return merged
                else:
                    print(f"[m365] detail fetch {pkg_id} -> {r.status_code}")
            except Exception as exc:
                print(f"[m365] detail fetch failed {pkg_id}: {exc}")
        return pkg

    print(f"[m365] enriching {len(packages)} packages with per-agent detail …")
    try:
        packages = list(await asyncio.gather(*[_fetch_detail(p) for p in packages]))
    finally:
        await _detail_client.aclose()
    tools_found = sum(1 for p in packages if any(p.get(f) for f in _ALL_TOOL_FIELDS))
    print(f"[m365] enrichment done — {tools_found} package(s) have tool data")

    print(f"[m365] total packages fetched: {len(packages)}")
    logs.append(f"catalog/packages: fetched {len(packages)} agent(s)")
    return packages, logs



# ---------------------------------------------------------------------------
# Normalise + DB upsert
# ---------------------------------------------------------------------------

def _fix_encoding(s: str) -> str:
    """Fix double-encoded UTF-8 (Latin-1 bytes re-decoded as UTF-8).
    Handles cases like 'Amadeus Advisorâ¢' → 'Amadeus Advisor™'.
    """
    if not s:
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def _normalize(raw: Dict, platform: str) -> Dict:
    # For catalog/packages, 'id' is the canonical Title ID (P_xxx / T_xxx).
    # Prefer 'id' first so source_hash is stable across API surfaces and sync runs.
    mid  = str(raw.get("id") or raw.get("appId") or raw.get("assetId") or raw.get("botid") or "").strip()
    # M365 Admin API uses "title"; Graph catalog uses "displayName"; bots use "name"
    name = _fix_encoding((raw.get("displayName") or raw.get("title") or raw.get("name") or "").strip()) or "Unnamed Agent"

    # catalog/packages puts the description inside shortDescription / longDescription
    desc = _fix_encoding((
        raw.get("longDescription")
        or raw.get("shortDescription")
        or raw.get("description")
        or f"Microsoft 365 agent: {name}"
    ).strip())

    builder = raw.get("builderInfo") or {}
    pub   = _fix_encoding((raw.get("publisherName") or raw.get("developerName") or raw.get("publisher") or builder.get("name") or "Microsoft 365").strip())
    instr = (raw.get("instructions") or "").strip()
    return {
    "m365_id":      mid,
    "source_hash":  hashlib.sha256(mid.encode()).hexdigest(),
    "display_name": name,
    "description":  desc,
    "publisher":    pub,
    "platform":     platform,
    "instruction":  instr,
    }


async def _upsert(fields: Dict, tenant_id: str, db: AsyncSession) -> Tuple[str, str, str]:
    """Returns (action, agent_internal_id, agent_id)."""
    row = (await db.execute(
        text(f"SELECT agent_id, agent_internal_id FROM {CORE}.agents"
            f" WHERE source_hash=:sh AND tenant_id=:tid AND is_current=true"),
        {"sh": fields["source_hash"], "tid": tenant_id},
    )).fetchone()

    print("=" * 80)
    print("[UPSERT]")
    print("Agent:", fields["display_name"])
    print("M365 ID:", fields["m365_id"])
    print("Source Hash:", fields["source_hash"])
    print("Existing Row:", row)
    print("=" * 80)

    if row:
        print("ACTION = UPDATED")
        aid, iid = row[0], row[1]

        await db.execute(
            text(f"""
                UPDATE {CORE}.agents
                SET agent_name = :n,
                    agent_description = :d,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE agent_id = :aid
                AND tenant_id = :tid
            """),
            {
                "n": fields["display_name"],
                "d": fields["description"],
                "aid": aid,
                "tid": tenant_id,
            },
        )

        await db.execute(
            text(f"""
                UPDATE {CORE}.agent_identifications
                SET instruction = :instr,
                    role = :role,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE agent_id = :aid
                AND tenant_id = :tid
                AND is_current = true
            """),
            {
                "instr": fields["instruction"],
                "role": fields["publisher"],
                "aid": aid,
                "tid": tenant_id,
            },
        )

        return "updated", iid, aid

    iid, aid = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(f"""INSERT INTO {CORE}.agents
                 (tenant_id,agent_internal_id,agent_id,agent_name,agent_description,
                  source_system,source_hash,created_ts,updated_ts,is_current,agent_type)
                 VALUES(:tid,:iid,:aid,:n,:d,:src,:sh,
                        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,true,'M365-Agent')"""),
        {"tid": tenant_id, "iid": iid, "aid": aid,
         "n": fields["display_name"], "d": fields["description"],
         "src": f"Microsoft 365 – {fields['platform']}", "sh": fields["source_hash"]},
    )
    await db.execute(
        text(f"""INSERT INTO {CORE}.agent_identifications
                 (tenant_id,agent_internal_id,agent_id,instruction,role,
                  governance_status,created_ts,updated_ts,is_current)
                 VALUES(:tid,:iid,:aid,:instr,:role,
                        'Pending Review',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,true)"""),
        {"tid": tenant_id, "iid": iid, "aid": aid,
         "instr": fields["instruction"], "role": fields["publisher"]},
    )
    print("ACTION = CREATED")
    return "created", iid, aid

# ---------------------------------------------------------------------------
# Inbound webhook — single agent push
# ---------------------------------------------------------------------------

class Agent365Payload(BaseModel):
    id:              str            = Field(..., description="Unique agent ID from Microsoft 365")
    displayName:     str
    description:     Optional[str] = None
    publisher:       Optional[str] = None
    capabilities:    Optional[List[str]] = None
    instructions:    Optional[str] = None
    tenantId:        Optional[str] = None


class Agent365AuthCredentials(BaseModel):
    tenant_id: str = ""
    client_id: str = ""
    client_secret: str = ""


@router.post("/inbound")
async def receive_agent365(
    body: Agent365Payload,
    x_webhook_secret: Optional[str] = Header(default=None),
    x_tenant_id:      Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not _WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="AGENT365_WEBHOOK_SECRET is not configured")
    if x_webhook_secret != _WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
    tid = (x_tenant_id or "").strip() or (body.tenantId or "").strip()
    if not tid:
        raise HTTPException(status_code=400, detail="x-tenant-id header required")
    fields = _normalize({"id": body.id, "displayName": body.displayName,
                          "description": body.description, "publisher": body.publisher,
                          "instructions": body.instructions, "capabilities": body.capabilities},
                        "Copilot Studio")
    action, _, _ = await _upsert(fields, tid, db)
    await db.commit()
    return {"status": action, "agent_name": fields["display_name"]}


# ---------------------------------------------------------------------------
# Full sync endpoint
# ---------------------------------------------------------------------------
import traceback as _traceback

@router.post("/sync")
async def sync_from_m365(
    x_tenant_id:      str           = Header(...),
    x_webhook_secret: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
    auth: dict = Depends(require_portal_admin),
):
    """
    Fetch ALL Microsoft 365 agents and save them to the Tavro Agent Catalog.

    Source 1 — Microsoft Graph Package Management API
    """
    print("=" * 60)
    print("AGENT365 SYNC STARTED")
    print("=" * 60)

    if _WEBHOOK_SECRET and x_webhook_secret != _WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    tenant_id = x_tenant_id.strip()
    print(f"[sync] x_tenant_id={tenant_id!r}")

    az_tenant, client_id, client_secret = _creds()
    print(f"[sync] az_tenant={'SET' if az_tenant else 'MISSING'} "
          f"client_id={'SET' if client_id else 'MISSING'} "
          f"client_secret={'SET' if client_secret else 'MISSING'}")

    if not all([az_tenant, client_id, client_secret]):
        raise HTTPException(status_code=503,
                            detail="AGENT365_TENANT_ID / CLIENT_ID / CLIENT_SECRET not set")

    all_agents: List[Dict] = []
    all_logs:   List[str]  = []

    # ── Source 1: M365 Admin Center API / Graph ───────────────────────────────
    print("[sync] Starting Source 1: _fetch_m365_agents …")
    try:
        m_agents, m_logs = await _fetch_m365_agents(az_tenant, client_id)
        all_logs.extend(m_logs)
        for a in m_agents:
            a["_platform"] = a.get("platform", "Microsoft 365")
        all_agents.extend(m_agents)
        print(f"[sync] Source 1 done: {len(m_agents)} agents")
    except Exception as exc:
        tb = _traceback.format_exc()
        msg = f"Source 1 (M365) FAILED: {exc}\n{tb}"
        print(msg)
        all_logs.append(msg)



    print(f"[sync] Total agents before dedup: {len(all_agents)}")

    if not all_agents:
        print("[sync] 0 agents found across all sources")
        print("[sync] diagnostic logs:")
        for line in all_logs:
            print(f"  {line}")
        return {"status": "ok", "created": 0, "updated": 0, "total": 0,
                "logs": all_logs, "message": "0 agents found. Run /diagnose for details."}

    # ── Dedup + DB upsert ─────────────────────────────────────────────────────
    seen_ids: set = set()
    created = updated = skipped = 0
    upsert_errors = 0
    for idx, raw in enumerate(all_agents):
        platform = raw.pop("_platform", "Microsoft 365")
        try:
            fields = _normalize(raw, platform)
        except Exception as exc:
            msg = f"_normalize error idx={idx} platform={platform}: {exc}"
            print(msg)
            all_logs.append(msg)
            skipped += 1
            continue

        if not fields["m365_id"]:
            skipped += 1
            all_logs.append(f"SKIPPED missing id platform={platform} keys={list(raw.keys())[:30]}")
            continue

        if fields["m365_id"] in seen_ids:
            skipped += 1
            continue
        seen_ids.add(fields["m365_id"])

        try:
            action, agent_iid, agent_aid = await _upsert(fields, tenant_id, db)
            created += action == "created"
            updated += action == "updated"
        except Exception as exc:
            tb = _traceback.format_exc()
            msg = f"_upsert error id={fields['m365_id']} name={fields['display_name']}: {exc}\n{tb}"
            print(msg)
            all_logs.append(msg)
            upsert_errors += 1
            continue

        
    print(f"[sync] Upsert loop done: created={created} updated={updated} skipped={skipped} errors={upsert_errors}")

    # ── Remove stale agents ───────────────────────────────────────────────────
    # Any M365 agent in the DB that was NOT in this sync batch is outdated.
    # Mark it inactive so it disappears from the catalog.
    deactivated = 0
    if seen_ids:
        try:
            hashes_in_sync = [
                hashlib.sha256(mid.encode()).hexdigest() for mid in seen_ids
            ]
            placeholders = ", ".join(f":h{i}" for i in range(len(hashes_in_sync)))
            params = {f"h{i}": h for i, h in enumerate(hashes_in_sync)}
            params["tid"] = tenant_id
            result = await db.execute(
                text(
                    f"UPDATE {CORE}.agents SET is_current=false, updated_ts=CURRENT_TIMESTAMP"
                    f" WHERE tenant_id=:tid"
                    f"   AND source_system LIKE 'Microsoft 365%'"
                    f"   AND is_current=true"
                    f"   AND source_hash NOT IN ({placeholders})"
                ),
                params,
            )
            deactivated = result.rowcount if result.rowcount is not None else 0
            print(f"[sync] Deactivated {deactivated} stale M365 agent(s)")
            all_logs.append(f"Deactivated {deactivated} stale agent(s) not in this sync")
        except Exception as exc:
            tb = _traceback.format_exc()
            print(f"[sync] Deactivate stale agents FAILED (non-fatal): {exc}\n{tb}")

    try:
        await db.commit()
        print("[sync] DB commit OK")
    except Exception as exc:
        tb = _traceback.format_exc()
        msg = f"DB commit FAILED: {exc}\n{tb}"
        print(msg)
        all_logs.append(msg)
        raise HTTPException(status_code=500, detail=msg)

    print("AGENT365 SYNC LOGS:")
    for line in all_logs:
        print(line)
    print(f"AGENT365 RESULT: created={created}, updated={updated}, skipped={skipped}, errors={upsert_errors}")
    print("=" * 60)

    return {
        "status": "ok",
        "total": created + updated,
        "deactivated": deactivated,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "upsert_errors": upsert_errors,
        "logs": all_logs,
    }


# ---------------------------------------------------------------------------
# Diagnose
# ---------------------------------------------------------------------------

@router.get("/diagnose")
async def diagnose_agent365(auth: dict = Depends(require_portal_admin)):
    """Probe every source — writes nothing to DB."""
    az_tenant, client_id, client_secret = _creds()

    result: Dict[str, Any] = {
        "env_vars": {
            "AGENT365_TENANT_ID":               bool(az_tenant),
            "AGENT365_CLIENT_ID":               bool(client_id),
            "AGENT365_CLIENT_SECRET":           bool(client_secret),
            "AZURE_AI_FOUNDRY_KEY":             bool(os.getenv("AZURE_AI_FOUNDRY_KEY")),
            "AZURE_AI_FOUNDRY_HOSTED_KEY":      bool(os.getenv("AZURE_AI_FOUNDRY_HOSTED_KEY")),
            "AZURE_AI_FOUNDRY_ENDPOINT":        os.getenv("AZURE_AI_FOUNDRY_ENDPOINT",        "")[:60] or "not set",
            "AZURE_AI_FOUNDRY_HOSTED_ENDPOINT": os.getenv("AZURE_AI_FOUNDRY_HOSTED_ENDPOINT", "")[:60] or "not set",
            "AZURE_SUBSCRIPTION_ID":            os.getenv("AZURE_SUBSCRIPTION_ID",            "")[:30] or "not set",
            "AZURE_ORG_URL":                    os.getenv("AZURE_ORG_URL",                    "")[:60] or "not set",
        },
        "sources": [],
    }

    if not all([az_tenant, client_id, client_secret]):
        result["status"] = "missing_credentials"
        return result

    async with httpx.AsyncClient(timeout=20) as client:

        # Test 1: delegated token → Graph beta catalog/packages
        # Only this API is used (no fallback to any other endpoint).
        refresh_token_present = bool(os.getenv("AGENT365_REFRESH_TOKEN", "").strip())
        delegated_token = await _get_delegated_token(az_tenant, client_id) if refresh_token_present else None
        if delegated_token:
            d_headers = {"Authorization": f"Bearer {delegated_token}"}
            for url, label in [
                (_CATALOG_V1,   "Graph v1.0 catalog/packages (delegated)"),
                (_CATALOG_BETA, "Graph beta catalog/packages (delegated)"),
            ]:
                try:
                    resp = await client.get(url, headers=d_headers, params={"$top": "1"})
                    ct = resp.headers.get("content-type", "")
                    d: Dict = {}
                    try: d = resp.json()
                    except Exception: pass
                    batch = d.get("value", [])
                    entry: Dict[str, Any] = {
                        "source": label, "url": url,
                        "status_code": resp.status_code,
                        "items_on_first_page": len(batch) if resp.status_code == 200 and "html" not in ct else 0,
                    }
                    if resp.status_code != 200 or "html" in ct:
                        entry["error"] = (d.get("error", {}).get("message") if isinstance(d.get("error"), dict) else None) or resp.text[:200]
                    result["sources"].append(entry)
                    if resp.status_code == 200 and "html" not in ct:
                        break
                except Exception as exc:
                    result["sources"].append({"source": label, "error": str(exc)})
        else:
            result["sources"].append({
                "source": "Graph catalog/packages (delegated token)",
                "status": "no_refresh_token",
                "action": "Click 'Connect with Microsoft' in the Agent 365 connector to sign in via Device Code Flow",
            })

    catalog_ok = any(
        "catalog/packages" in s.get("source", "") and s.get("status_code") == 200
        for s in result["sources"]
    )
    result["status"] = "ready" if catalog_ok else "needs_auth"
    result["recommendation"] = (
        "Run POST /api/v1/agent365/auth/start to connect via Device Code Flow. "
        "A Global Admin must sign in once to grant delegated access."
        if not catalog_ok
        else "catalog/packages API is accessible. Run Connector to sync agents."
    )
    return result


# ---------------------------------------------------------------------------
# Device Code Flow — one-time admin sign-in to get delegated token
#
# IMPORTANT (Entra-side prerequisite, code can't substitute for this):
#   The app registration must have "Allow public client flows" = Yes
#   (Entra ID → App registrations → <app> → Authentication → bottom of page).
#   Device code grant is always treated as a public-client flow by Entra,
#   even for apps that also have a client secret. Without this toggle,
#   the /token exchange below always fails with AADSTS7000218 regardless
#   of whether client_secret is present/correct.
# ---------------------------------------------------------------------------

def _device_session_path() -> Path:
    """Where pending device-code sessions are persisted (survives restarts
    and is shared across workers, unlike the old in-memory dict)."""
    env_file = next((p for p in _env_files() if p.exists()), _ENV_FILE)
    return env_file.parent / ".agent365_device_sessions.json"


def _load_device_sessions() -> Dict[str, Dict[str, str]]:
    path = _device_session_path()
    if not path.exists():
        return {}
    try:
        import json
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_device_session(device_code: str, creds: "Agent365AuthCredentials") -> None:
    import json
    sessions = _load_device_sessions()
    sessions[device_code] = {
        "tenant_id": creds.tenant_id,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
    }
    _device_session_path().write_text(json.dumps(sessions), encoding="utf-8")


def _pop_device_session(device_code: str) -> Optional[Dict[str, str]]:
    import json
    sessions = _load_device_sessions()
    entry = sessions.pop(device_code, None)
    if entry is not None:
        _device_session_path().write_text(json.dumps(sessions), encoding="utf-8")
    return entry


# ---------------------------------------------------------------------------
# Device Code Flow endpoints
# ---------------------------------------------------------------------------

class _DeviceCodeStartBody(BaseModel):
    tenant_id: str = ""
    client_id: str = ""
    client_secret: str = ""


class _DeviceCodePollBody(BaseModel):
    device_code: str
    tenant_id: str = ""
    client_id: str = ""
    client_secret: str = ""


@router.post("/auth/start")
async def agent365_auth_start(body: _DeviceCodeStartBody, auth: dict = Depends(require_portal_admin)):
    """Initiate Microsoft Device Code Flow — returns user_code + verification_uri."""
    tenant_id, client_id, _ = _creds()
    tenant_id  = body.tenant_id.strip()  or tenant_id
    client_id  = body.client_id.strip()  or client_id

    if not tenant_id or not client_id:
        raise HTTPException(status_code=400, detail="tenant_id and client_id are required")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode",
            data={
                "client_id": client_id,
                "scope":     _GRAPH_DELEGATED_SCOPE,
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])

    data = resp.json()
    device_code = data.get("device_code", "")
    creds_for_session = _DeviceCodeStartBody(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=body.client_secret.strip() or _creds()[2],
    )
    _save_device_session(device_code, creds_for_session)  # type: ignore[arg-type]

    return {
        "device_code":     device_code,
        "user_code":       data.get("user_code", ""),
        "verification_uri": data.get("verification_uri", ""),
        "expires_in":      data.get("expires_in", 900),
        "interval":        data.get("interval", 5),
    }


@router.post("/auth/poll")
async def agent365_auth_poll(body: _DeviceCodePollBody, auth: dict = Depends(require_portal_admin)):
    """Poll for token completion; on success persists the refresh token to .env."""
    saved = _pop_device_session(body.device_code)
    tenant_id     = body.tenant_id.strip()     or (saved or {}).get("tenant_id", "") or _creds()[0]
    client_id     = body.client_id.strip()     or (saved or {}).get("client_id", "") or _creds()[1]
    client_secret = body.client_secret.strip() or (saved or {}).get("client_secret", "") or _creds()[2]

    if not tenant_id or not client_id:
        raise HTTPException(status_code=400, detail="tenant_id and client_id are required")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
                "client_id":   client_id,
                "device_code": body.device_code,
                # Public client app — must NOT send client_secret (AADSTS700025)
            },
        )

    data = resp.json()
    error = data.get("error", "")

    if error == "authorization_pending":
        # Re-persist session so the next poll call still has credentials
        _save_device_session(body.device_code, _DeviceCodeStartBody(  # type: ignore[arg-type]
            tenant_id=tenant_id, client_id=client_id, client_secret=client_secret,
        ))
        return {"pending": True}

    if resp.status_code != 200 or error:
        raise HTTPException(
            status_code=resp.status_code or 400,
            detail=data.get("error_description", error or resp.text[:200]),
        )

    refresh_token = data.get("refresh_token", "")
    if refresh_token:
        with _env_lock:
            for env_path in _env_files():
                if not env_path.exists():
                    continue
                lines = env_path.read_text(encoding="utf-8").splitlines()
                found = False
                for i, line in enumerate(lines):
                    if line.strip().startswith("AGENT365_REFRESH_TOKEN="):
                        lines[i] = f"AGENT365_REFRESH_TOKEN={refresh_token}"
                        found = True
                        break
                if not found:
                    lines.append(f"AGENT365_REFRESH_TOKEN={refresh_token}")
                env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            os.environ["AGENT365_REFRESH_TOKEN"] = refresh_token

    return {"status": "ok", "refresh_token_saved": bool(refresh_token)}


async def _get_delegated_token(tenant_id: str, client_id: str) -> Optional[str]:
    """Exchange AGENT365_REFRESH_TOKEN for a fresh delegated access token."""
    refresh_token = _env_value("AGENT365_REFRESH_TOKEN")
    if not refresh_token:
        print("[delegated_token] no AGENT365_REFRESH_TOKEN in env")
        return None

    # Device Code flow requires the app to be a public client in Entra
    # ("Allow public client flows" = Yes). Public clients must NOT send
    # client_secret on token refresh — Entra returns AADSTS700025 if it is sent.
    for tid in [tenant_id, "common"]:
        token_url = _TOKEN_URL.format(tenant_id=tid)
        post_data: Dict[str, str] = {
            "grant_type":    "refresh_token",
            "client_id":     client_id,
            "refresh_token": refresh_token,
            "scope":         _GRAPH_DELEGATED_SCOPE,
        }
        # No client_secret — public client apps must omit it entirely.

        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(token_url, data=post_data)

        print(f"[delegated_token] token refresh ({tid}) -> {resp.status_code}")
        if resp.status_code != 200:
            print(f"[delegated_token] error: {resp.text[:300]}")
            continue

        data = resp.json()
        new_rt = data.get("refresh_token", "")
        if new_rt and new_rt != refresh_token:
            with _env_lock:
                os.environ["AGENT365_REFRESH_TOKEN"] = new_rt
                for env_path in _env_files():
                    if not env_path.exists():
                        continue
                    lines = env_path.read_text(encoding="utf-8").splitlines()
                    for i, line in enumerate(lines):
                        if line.strip().startswith("AGENT365_REFRESH_TOKEN="):
                            lines[i] = f"AGENT365_REFRESH_TOKEN={new_rt}"
                            break
                    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        return data.get("access_token")

    print("[delegated_token] all token refresh attempts failed")
    return None


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@router.get("/inbound/health")
async def agent365_health():
    tenant, cid, _ = _creds()
    return {
        "status":              "ok",
        "credentials_present": bool(tenant and cid),
        "foundry_key_present": bool(os.getenv("AZURE_AI_FOUNDRY_KEY")),
        "foundry_endpoint":    bool(os.getenv("AZURE_AI_FOUNDRY_ENDPOINT")),
    }


@router.get("/debug/package/{package_id}")
async def debug_package(package_id: str):
    """
    Fetch the raw Graph API detail for any package ID and return the full
    structure so we can identify where tools/actions are stored.
    Useful for inspecting T_ (Copilot Studio / Foundry) agents.
    """
    az_tenant, client_id, _ = _creds()
    if not az_tenant or not client_id:
        raise HTTPException(status_code=503, detail="AGENT365 credentials not configured")

    token = await _get_delegated_token(az_tenant, client_id)
    if not token:
        raise HTTPException(status_code=401, detail="No delegated token — complete Device Code sign-in first")

    base = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{base}/{package_id}", headers={"Authorization": f"Bearer {token}"})

    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text[:500])

    raw = r.json()

    # Parse elementDetails definitions so they're readable (not double-JSON strings)
    parsed_elements = []
    for ed in (raw.get("elementDetails") or []):
        for el in (ed.get("elements") or []):
            defn = el.get("definition", "")
            try:
                defn = json.loads(defn) if isinstance(defn, str) else defn
            except Exception:
                pass
            parsed_elements.append({
                "elementType": ed.get("elementType"),
                "id": el.get("id"),
                "definition": defn,
            })

    return {
        "id":             raw.get("id"),
        "displayName":    raw.get("displayName"),
        "type":           raw.get("type"),
        "elementTypes":   raw.get("elementTypes"),
        "top_level_keys": list(raw.keys()),
        "capabilities":   raw.get("capabilities"),
        "actions":        raw.get("actions"),
        "tools":          raw.get("tools"),
        "plugins":        raw.get("plugins"),
        "customActions":  raw.get("customActions"),
        "extensions":     raw.get("extensions"),
        "parsed_elements": parsed_elements,
        "raw": raw,
    }


# ---------------------------------------------------------------------------
# Package Management API — proxy to Microsoft Graph beta
# All six operations require a delegated token (device code sign-in).
# Scope: CopilotPackages.Read.All  (read)
#        CopilotPackages.ReadWrite.All  (update / block / unblock / reassign)
# ---------------------------------------------------------------------------

_PACKAGES_BASE = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"


async def _delegated_headers() -> Dict[str, str]:
    """Return Authorization header using the stored delegated refresh token."""
    tenant_id, client_id, _ = _creds()
    if not tenant_id or not client_id:
        raise HTTPException(status_code=503, detail="AGENT365 credentials not configured")
    token = await _get_delegated_token(tenant_id, client_id)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="No delegated token available. Complete Device Code sign-in in the Agent 365 connector first.",
        )
    return {"Authorization": f"Bearer {token}"}


class _PackageAccessEntity(BaseModel):
    resourceType: str
    resourceId:   str


class _UpdatePackageBody(BaseModel):
    allowedUsersAndGroups: Optional[List[_PackageAccessEntity]] = None
    acquireUsersAndGroups: Optional[List[_PackageAccessEntity]] = None


class _ReassignBody(BaseModel):
    userId: str


# GET /api/v1/agent365/packages
@router.get("/packages")
async def list_packages(
    filter: Optional[str] = None,
    top:    Optional[int] = None,
    skip:   Optional[int] = None,
    skiptoken: Optional[str] = None,
):
    """
    List all M365 Copilot packages (agents and apps) in the tenant.
    Supports $filter on supportedHosts, elementTypes, lastModifiedDateTime.
    """
    headers = await _delegated_headers()
    params: Dict[str, Any] = {}
    if filter:
        params["$filter"] = filter
    if top:
        params["$top"] = top
    if skip:
        params["$skip"] = skip
    if skiptoken:
        params["$skiptoken"] = skiptoken

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(_PACKAGES_BASE, headers=headers, params=params)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
    return resp.json()


# GET /api/v1/agent365/packages/{package_id}
@router.get("/packages/{package_id}")
async def get_package(package_id: str):
    """Retrieve detailed metadata for a specific agent or app by ID."""
    headers = await _delegated_headers()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_PACKAGES_BASE}/{package_id}", headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
    return resp.json()


# PATCH /api/v1/agent365/packages/{package_id}
@router.patch("/packages/{package_id}", status_code=204)
async def update_package(package_id: str, body: _UpdatePackageBody):
    """
    Update allowedUsersAndGroups and/or acquireUsersAndGroups for a package.
    Returns 204 No Content on success.
    """
    headers = await _delegated_headers()
    headers["Content-Type"] = "application/json"
    payload = body.model_dump(exclude_none=True)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(f"{_PACKAGES_BASE}/{package_id}", headers=headers, json=payload)
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


# POST /api/v1/agent365/packages/{package_id}/block
@router.post("/packages/{package_id}/block", status_code=204)
async def block_package(package_id: str):
    """Block a package to prevent its usage across the organization."""
    headers = await _delegated_headers()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{_PACKAGES_BASE}/{package_id}/block", headers=headers)
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


# POST /api/v1/agent365/packages/{package_id}/unblock
@router.post("/packages/{package_id}/unblock", status_code=204)
async def unblock_package(package_id: str):
    """Unblock a package to allow its usage across the organization."""
    headers = await _delegated_headers()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{_PACKAGES_BASE}/{package_id}/unblock", headers=headers)
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


# POST /api/v1/agent365/packages/{package_id}/reassign
@router.post("/packages/{package_id}/reassign", status_code=204)
async def reassign_package(package_id: str, body: _ReassignBody):
    """Reassign ownership of a package to a different user."""
    headers = await _delegated_headers()
    headers["Content-Type"] = "application/json"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{_PACKAGES_BASE}/{package_id}/reassign",
            headers=headers,
            json={"userId": body.userId},
        )
    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


# ---------------------------------------------------------------------------
# Connector class — used by the Admin Portal "Run Connector" button
# ---------------------------------------------------------------------------

_PACKAGES_URL = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"
_DEVICE_SCOPE = "https://graph.microsoft.com/.default offline_access"


def _write_env_value(key: str, value: str) -> None:
    for env_file in _env_files():
        if not env_file.exists():
            continue
        lines = env_file.read_text(encoding="utf-8").splitlines()
        found = False
        for idx, line in enumerate(lines):
            if line.strip().startswith(f"{key}="):
                lines[idx] = f"{key}={value}"
                found = True
                break
        if not found:
            lines.append(f"{key}={value}")
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value


class Agent365InboundConnector(BaseConnector):
    def __init__(self, config: dict):
        self.config = config or {}
        self.access_token: Optional[str] = None

    def validate_config(self):
        missing = [
            key
            for key in ("tenant_id", "client_id", "client_secret")
            if not self.config.get(key) and not _env_value(f"AGENT365_{key.upper()}")
        ]
        if missing:
            raise ValueError("Missing Agent365 config keys: " + ", ".join(missing))

    def authenticate(self):
        tenant_id = self._tenant_id()
        client_id = self._client_id()
        refresh_token = self._refresh_token()
        if not refresh_token:
            raise ValueError("Missing AGENT365_REFRESH_TOKEN. Complete Microsoft sign-in first.")

        for tid in (tenant_id, "common"):
            resp = requests.post(
                _TOKEN_URL.format(tenant_id=tid),
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "refresh_token": refresh_token,
                    "scope": _DEVICE_SCOPE,
                },
                timeout=30,
            )
            print(f"[agent365] token refresh ({tid}) -> {resp.status_code}")
            if resp.status_code != 200:
                print(f"[agent365] token refresh error: {resp.text[:300]}")
                continue

            data = resp.json()
            new_refresh_token = data.get("refresh_token", "")
            if new_refresh_token and new_refresh_token != refresh_token:
                _write_env_value("AGENT365_REFRESH_TOKEN", new_refresh_token)
            self.access_token = data.get("access_token")
            return

        raise RuntimeError("Unable to refresh Microsoft delegated token")

    def _tenant_id(self) -> str:
        return (self.config.get("tenant_id") or _env_value("AGENT365_TENANT_ID")).strip()

    def _client_id(self) -> str:
        return (self.config.get("client_id") or _env_value("AGENT365_CLIENT_ID")).strip()

    def _refresh_token(self) -> str:
        return (self.config.get("refresh_token") or _env_value("AGENT365_REFRESH_TOKEN")).strip()

    def _num_agents_to_fetch(self) -> Optional[int]:
        raw = str(self.config.get("num_agents") or _env_value("AGENT365_NUM_AGENTS") or "").strip()
        if not raw:
            return None
        try:
            n = int(raw)
        except ValueError:
            return None
        return n if n > 0 else None

    def fetch_metadata(self) -> List[Dict]:
        if not self.access_token:
            raise RuntimeError("Agent365 connector is not authenticated")

        headers = {"Authorization": f"Bearer {self.access_token}"}
        packages: List[dict] = []
        url: Optional[str] = _PACKAGES_URL
        while url:
            resp = requests.get(url, headers=headers, timeout=60)
            print(f"[agent365] catalog packages -> {resp.status_code}")
            if resp.status_code != 200:
                raise RuntimeError(f"Graph catalog packages failed ({resp.status_code}): {resp.text[:300]}")
            data = resp.json()
            packages.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

        return [p for p in packages if self._is_agent_package(p)]

    def _is_agent_package(self, package: dict) -> bool:
        package_id = str(package.get("id") or "")
        if package_id.startswith("T_"):
            return True
        element_types = {str(item).lower() for item in (package.get("elementTypes") or [])}
        if element_types.intersection({
            "copilotagent", "declarativeagent", "declarativecopilots",
            "customcopilot", "agentskills", "agentconnectors",
        }):
            return True
        hosts = {str(item).lower() for item in (package.get("supportedHosts") or [])}
        return "copilot" in hosts or "microsoftcopilot" in hosts

    def normalize(self, records: List[Dict]) -> List[Dict]:
        bots: List[Dict] = []
        seen_ids: set = set()
        for record in records:
            bot_id = str(record.get("id") or record.get("appId") or "").strip()
            if not bot_id or bot_id in seen_ids:
                continue
            seen_ids.add(bot_id)
            name = _fix_encoding((
                record.get("displayName") or record.get("title") or
                record.get("name") or "Unnamed Agent"
            ).strip())
            description = _fix_encoding((
                record.get("longDescription") or record.get("shortDescription") or
                record.get("description") or f"Microsoft 365 agent: {name}"
            ).strip())
            builder = record.get("builderInfo") or {}
            publisher = _fix_encoding((
                record.get("publisherName") or record.get("developerName") or
                record.get("publisher") or builder.get("name") or "Microsoft 365"
            ).strip())
            instruction = self._build_instruction(record)
            bots.append({
                "botid": bot_id,
                "name": name,
                "description": description,
                "instruction": instruction,
                "provider_name": f"Microsoft 365 - {publisher}",
                "version": record.get("version") or "",
                # Agent 365 agents should not populate the catalog Lineage Map
                # (no self-referential or auto-derived tool entries).
                "tool": [],
                "source_hash": hashlib.sha256(bot_id.encode()).hexdigest(),
            })
        return bots

    def _build_instruction(self, record: dict) -> str:
        return (record.get("instructions") or "").strip()

    def execute(self):
        import worker as _worker
        print("Running Agent365 Inbound Connector")
        self.validate_config()
        self.authenticate()

        records = self.fetch_metadata()

        num_agents = self._num_agents_to_fetch()
        if num_agents is not None:
            if num_agents > len(records):
                raise ValueError(
                    f"There are only {len(records)} agent(s) available in Microsoft Agent 365 "
                    f"(requested {num_agents})."
                )
            if num_agents < len(records):
                records = random.sample(records, num_agents)
                print(f"Randomly sampled {num_agents} of the discovered agent(s)")

        bots = self.normalize(records)
        if not bots:
            print("No Agent365 agents found")
            return

        print(f"Found {len(bots)} Agent365 agent(s)")
        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open("r", encoding="utf-8") as fh:
            template = json.load(fh)

        agent_cards = transform_to_agent_cards(
            bots, {"agent_id_map": {}}, template, "agent365_inbound",
        )

        for card, bot in zip(agent_cards, bots):
            card_data = card.get("data", card) if isinstance(card, dict) else card
            card_data.setdefault("provider", {})["organization"] = bot.get("provider_name") or "Microsoft 365"
            card_data["version"] = bot.get("version") or ""
            if bot.get("tool"):
                card_data["tool"] = [
                    {
                        "identifier": tool.get("id") or tool.get("name"),
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": "Agent365",
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None,
                    }
                    for tool in bot["tool"]
                    if tool.get("name")
                ]
            _worker.process_card(card_data)

        print("Agent365 inbound execution completed successfully")
