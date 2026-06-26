"""
AICT Inbound Connector — imports agents, AI models, tools and agent-to-agent
relationships from ServiceNow AICT into the Tavro agent catalog.

Agent flow:
  1. sn_ai_governance_asset_governance_details  (recent 5, newest first)
       └─ sys_id  → agent_id in Tavro
       └─ asset.value → asset_sys_id
  2. GET /api/sn_ent/asset/ai_system/{asset_sys_id}
       └─ name, description, version, provider.name → agent fields
       └─ ai_models[].sys_id → AI model sys_ids

AI model flow:
  3. GET /api/sn_ent/asset/ai_model/{ai_model_sys_id}
       └─ name, description, provider.name → linked to agent as ai_model

Tools flow (unchanged):
  4. sn_ent_ai_system_subcomponent_m2m (ai_system=asset_sys_id, table=sn_ent_ai_tool)
       └─ ai_subcomponent.value → sn_ent_ai_tool/{id} → name, description

"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .base_connector import BaseConnector
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card, execute_query, execute_dml, TENANT_ID

import html as _html
import re as _re

def _sq(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def _clean_html(text: str | None) -> str:
    if not text:
        return ""
    text = _html.unescape(text)
    text = _re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.split())

logger = logging.getLogger(__name__)

_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}


class AICTInboundConnector(BaseConnector):

    def __init__(self, config: dict):
        self.config = config
        self.instance_url = (config.get("instance_url") or "").rstrip("/")
        self.auth = (config.get("username") or "", config.get("password") or "")
        retry = Retry(total=3, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry)
        self._session = requests.Session()
        self._session.auth = self.auth
        self._session.headers.update(_HEADERS)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

    def validate_config(self):
        missing = [k for k in ("instance_url", "username", "password") if not self.config.get(k)]
        if missing:
            raise ValueError("Missing AICT config keys: " + ", ".join(missing))

    def authenticate(self):
        pass

    # ── ServiceNow Table API (used for governance records, tools, child agents) ──

    def _get(self, table: str, sys_id: str = "", params: dict | None = None) -> dict | list:
        url = f"{self.instance_url}/api/now/table/{table}"
        if sys_id:
            url = f"{url}/{sys_id}"
        resp = self._session.get(url, params=params or {}, timeout=60)
        resp.raise_for_status()
        return resp.json().get("result", {} if sys_id else [])

    # ── AICT REST API (used for ai_system and ai_model) ──────────────────────────

    def _get_aict(self, resource: str, sys_id: str) -> dict:
        url = f"{self.instance_url}/api/sn_ent/asset/{resource}/{sys_id}"
        resp = self._session.get(url, timeout=60)
        resp.raise_for_status()
        return resp.json().get("result", {})

    # ── AI Models ─────────────────────────────────────────────────────────────────

    def _fetch_ai_models(self, ai_model_sys_ids: list[dict]) -> list[dict]:
        ai_models = []
        logger.info("AICT inbound: fetching %d linked ai_model(s)", len(ai_model_sys_ids))
        for entry in ai_model_sys_ids:
            sys_id = (entry.get("sys_id") or "").strip()
            if not sys_id:
                logger.warning("AICT inbound: ai_model entry has no sys_id, skipping: %s", entry)
                continue
            try:
                model = self._get_aict("ai_model", sys_id)
            except requests.exceptions.RequestException as e:
                logger.warning("AICT inbound: failed to fetch ai_model %s — %s", sys_id, e)
                continue
            name = (model.get("name") or "").strip()
            if not name:
                logger.warning("AICT inbound: ai_model %s returned no name, skipping", sys_id)
                continue
            ai_models.append({
                "name":        name,
                "description": _clean_html(model.get("description")),
                "provider":    (model.get("provider") or {}).get("name") or None,
                "version":     model.get("version") or None,
            })
            logger.info("AICT inbound: resolved ai_model '%s' (%s)", name, sys_id)

        return ai_models

    # ── Tools (unchanged) ─────────────────────────────────────────────────────────

    def _fetch_tools(self, asset_sys_id: str) -> list[dict]:
        tools = []
        try:
            m2m_records = self._get(
                "sn_ent_ai_system_subcomponent_m2m",
                params={
                    "sysparm_fields":        "ai_subcomponent,ai_subcomponent_reference_table",
                    "sysparm_display_value": "all",
                    "sysparm_query":         f"ai_system={asset_sys_id}^ai_subcomponent_reference_table=sn_ent_ai_tool",
                },
            )
        except requests.exceptions.RequestException as e:
            logger.warning("AICT inbound: failed to fetch tool subcomponents for asset %s — %s", asset_sys_id, e)
            return tools

        logger.info("AICT inbound: found %d tool subcomponent record(s) for asset %s", len(m2m_records), asset_sys_id)

        for rec in m2m_records:
            ref_table = (rec.get("ai_subcomponent_reference_table") or {}).get("value", "").strip()
            if ref_table != "sn_ent_ai_tool":
                continue

            tool_sys_id = (rec.get("ai_subcomponent") or {}).get("value", "").strip()
            if not tool_sys_id:
                logger.warning("AICT inbound: tool subcomponent record has no sys_id, skipping")
                continue

            try:
                tool_rec = self._get(
                    "sn_ent_ai_tool",
                    sys_id=tool_sys_id,
                    params={"sysparm_fields": "name,description,short_description", "sysparm_display_value": "false"},
                )
            except requests.exceptions.RequestException as e:
                logger.warning("AICT inbound: failed to fetch tool %s — %s", tool_sys_id, e)
                continue

            name = (tool_rec.get("name") or "").strip()
            if not name:
                logger.warning("AICT inbound: tool %s returned no name, skipping", tool_sys_id)
                continue

            tools.append({
                "identifier":          tool_sys_id,
                "name":                name,
                "description":         _clean_html(tool_rec.get("description") or tool_rec.get("short_description")),
                "delegation_possible": "false",
                "allowed_delegates":   None,
                "parameter_name":      None,
                "parameter_type":      None,
                "default_value":       None,
                "input_schema":        None,
                "output_schema":       None,
            })
            logger.info("AICT inbound: resolved tool '%s' (%s)", name, tool_sys_id)

        return tools

    # ── Child Agents ─────────────────────────────────────────────────────────────

    def _fetch_child_agents(self, asset_sys_id: str) -> list[dict]:
        """
        sn_ent_ai_system_subcomponent_m2m (filter: ai_system=asset_sys_id, table=alm_ai_system_digital_asset)
          └─ ai_subcomponent.value → child digital asset sys_id
        GET /api/sn_ent/asset/ai_system/{child_asset_sys_id}
          └─ name, description → child agent
        """
        children = []
        try:
            m2m_records = self._get(
                "sn_ent_ai_system_subcomponent_m2m",
                params={
                    "sysparm_fields":        "ai_subcomponent,ai_subcomponent_reference_table",
                    "sysparm_display_value": "all",
                    "sysparm_query":         f"ai_system={asset_sys_id}^ai_subcomponent_reference_table=alm_ai_system_digital_asset",
                },
            )
        except requests.exceptions.RequestException as e:
            logger.warning("AICT inbound: failed to fetch child agent subcomponents for asset %s — %s", asset_sys_id, e)
            return children

        logger.info("AICT inbound: found %d child agent subcomponent record(s) for asset %s", len(m2m_records), asset_sys_id)

        for rec in m2m_records:
            child_asset_sys_id = (rec.get("ai_subcomponent") or {}).get("value", "").strip()
            if not child_asset_sys_id:
                logger.warning("AICT inbound: child agent subcomponent record has no sys_id, skipping")
                continue
            try:
                child = self._get_aict("ai_system", child_asset_sys_id)
            except requests.exceptions.RequestException as e:
                logger.warning("AICT inbound: failed to fetch child ai_system %s — %s", child_asset_sys_id, e)
                continue

            child_name = (child.get("name") or "").strip()
            if not child_name:
                logger.warning("AICT inbound: child ai_system %s returned no name, skipping", child_asset_sys_id)
                continue

            children.append({
                "botid":       child_asset_sys_id,
                "name":        child_name,
                "description": _clean_html(child.get("description")),
                "instruction": "",
                "ai_model":    [],
                "tool":        [],
            })
            logger.info("AICT inbound: resolved child agent '%s' (%s)", child_name, child_asset_sys_id)

        return children

    # ── Main fetch ────────────────────────────────────────────────────────────────

    def fetch_metadata(self) -> list[dict]:
        # Step 1 — two targeted governance queries: one for ai_system, one for ai_model
        # Filter by asset.sys_class_name so we get exactly the 5 most recent of each type
        system_gov_records = self._get(
            "sn_ai_governance_asset_governance_details",
            params={
                "sysparm_fields":                "asset",
                "sysparm_exclude_reference_link": "true",
                "sysparm_limit":                 5,
                "sysparm_query":                 "asset.sys_class_name=alm_ai_system_digital_asset^ORDERBYDESCsys_created_on",
            },
        )
        model_gov_records = self._get(
            "sn_ai_governance_asset_governance_details",
            params={
                "sysparm_fields":                "asset",
                "sysparm_exclude_reference_link": "true",
                "sysparm_limit":                 5,
                "sysparm_query":                 "asset.sys_class_name=alm_ai_model_digital_asset^ORDERBYDESCsys_created_on",
            },
        )
        logger.info(
            "AICT inbound: fetched %d ai_system governance record(s), %d ai_model governance record(s)",
            len(system_gov_records), len(model_gov_records),
        )

        bots = []
        standalone_models = []
        seen_assets = set()

        # Process ai_system records first, then ai_model records
        # asset_class is known from the query so we skip the alm_ai_digital_asset type-check hop
        # but still pass through the same flow for consistency
        governance_records = [
            (gov, "alm_ai_system_digital_asset") for gov in system_gov_records
        ] + [
            (gov, "alm_ai_model_digital_asset") for gov in model_gov_records
        ]

        for gov, asset_class in governance_records:

            # asset is a plain string when sysparm_exclude_reference_link=true
            asset_sys_id = (gov.get("asset") or "").strip()
            if not asset_sys_id:
                logger.warning("AICT inbound: governance record has no asset reference, skipping")
                continue

            if asset_sys_id in seen_assets:
                logger.info("AICT inbound: asset %s already processed, skipping duplicate", asset_sys_id)
                continue
            seen_assets.add(asset_sys_id)

            logger.info("AICT inbound: processing asset %s (class=%s)", asset_sys_id, asset_class)

            # Fetch display_name from alm_ai_digital_asset as fallback name
            base_name = ""
            try:
                asset_meta = self._get(
                    "alm_ai_digital_asset",
                    sys_id=asset_sys_id,
                    params={
                        "sysparm_fields":                "display_name,sys_class_name",
                        "sysparm_exclude_reference_link": "true",
                    },
                )
                base_name = (asset_meta.get("display_name") or "").strip()
            except requests.exceptions.RequestException as e:
                logger.warning("AICT inbound: could not fetch asset display_name for %s — %s", asset_sys_id, e)

            if asset_class == "alm_ai_system_digital_asset":
                if len(bots) >= 5:
                    logger.info("AICT inbound: agent limit reached (5), skipping ai_system %s", asset_sys_id)
                    continue
                # Full agent flow — fetch from ai_system API
                try:
                    ai_system = self._get_aict("ai_system", asset_sys_id)
                except requests.exceptions.RequestException as e:
                    logger.warning("AICT inbound: could not fetch ai_system %s — %s", asset_sys_id, e)
                    continue

                name = (ai_system.get("name") or "").strip() or base_name or asset_sys_id
                provider_name = (ai_system.get("provider") or {}).get("name") or "ServiceNow AICT"

                # Resolve instruction from ai_prompts where name contains "instruction"
                instruction = ""
                ai_prompts = ai_system.get("ai_prompts") or []
                logger.info("AICT inbound: ai_system %s has %d prompt(s)", asset_sys_id, len(ai_prompts))
                for prompt_entry in ai_prompts:
                    prompt_name = (prompt_entry.get("name") or "").lower()
                    if "instruction" in prompt_name:
                        prompt_sys_id = (prompt_entry.get("sys_id") or "").strip()
                        if prompt_sys_id:
                            try:
                                prompt_rec = self._get_aict("ai_prompt", prompt_sys_id)
                                instruction = (prompt_rec.get("prompt_info") or "").strip()
                                logger.info("AICT inbound: resolved instruction from prompt %s", prompt_sys_id)
                            except requests.exceptions.RequestException as e:
                                logger.warning("AICT inbound: failed to fetch ai_prompt %s — %s", prompt_sys_id, e)
                        break

                try:
                    ai_models = self._fetch_ai_models(ai_system.get("ai_models") or [])
                except Exception as e:
                    logger.warning("AICT inbound: error fetching ai_models for %s — %s", asset_sys_id, e)
                    ai_models = []

                try:
                    tools = self._fetch_tools(asset_sys_id)
                except Exception as e:
                    logger.warning("AICT inbound: error fetching tools for %s — %s", asset_sys_id, e)
                    tools = []

                try:
                    child_agents = self._fetch_child_agents(asset_sys_id)
                except Exception as e:
                    logger.warning("AICT inbound: error fetching child agents for %s — %s", asset_sys_id, e)
                    child_agents = []

                bots.append({
                    "botid":         asset_sys_id,
                    "name":          name,
                    "description":   _clean_html(ai_system.get("description")),
                    "instruction":   instruction,
                    "version":       ai_system.get("version") or "",
                    "provider_name": provider_name,
                    "ai_model":      ai_models,
                    "tool":          tools,
                    "child_agents":  child_agents,
                })
                logger.info("AICT inbound: added agent '%s' (agent_id=%s) [%d/5]", name, asset_sys_id, len(bots))
                time.sleep(1)

            elif asset_class == "alm_ai_model_digital_asset":
                if len(standalone_models) >= 5:
                    logger.info("AICT inbound: model limit reached (5), skipping ai_model %s", asset_sys_id)
                    continue
                # Model asset flow — fetch from ai_model API, store in standalone_models
                try:
                    ai_model = self._get_aict("ai_model", asset_sys_id)
                except requests.exceptions.RequestException as e:
                    logger.warning("AICT inbound: could not fetch ai_model %s — %s", asset_sys_id, e)
                    continue

                name = (ai_model.get("name") or "").strip()
                if not name:
                    logger.warning("AICT inbound: ai_model %s has no name, skipping", asset_sys_id)
                    continue

                standalone_models.append({
                    "name":        name,
                    "description": _clean_html(ai_model.get("description")),
                    "version":     ai_model.get("version") or "",
                    "provider":    (ai_model.get("provider") or {}).get("name") or None,
                })
                logger.info("AICT inbound: added standalone model '%s' (%s) [%d/5]", name, asset_sys_id, len(standalone_models))

            else:
                logger.info(
                    "AICT inbound: skipping asset %s — unhandled class '%s'",
                    asset_sys_id, asset_class,
                )

        return bots, standalone_models

    def normalize(self, bots: list[dict]) -> list[dict]:
        return bots

    def _upsert_linked_ai_models(self, models: list[dict], tenant_id: str | None = None) -> None:
        from datetime import datetime, timezone
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        tenant_id = tenant_id or TENANT_ID or None
        select_rows = []
        for m in models:
            provider = (m.get("provider") or "").strip() or None
            version  = (m.get("version") or "").strip() or None
            select_rows.append(f"""
                SELECT
                    md5(lower(trim({_sq(m['name'])})))  AS ai_model_id,
                    {_sq(m['name'])}                    AS model_name,
                    {_sq(m.get('description'))}         AS description,
                    {_sq(provider)}                     AS provider,
                    {_sq(version)}                      AS version_number,
                    {_sq(tenant_id)}                    AS tenant_id,
                    TIMESTAMP '{now_str}'               AS now_ts
                WHERE NULLIF(trim({_sq(m['name'])}), '') IS NOT NULL
            """.strip())
        union_all = "\nUNION ALL\n".join(select_rows)
        execute_dml(f"""
            INSERT INTO core.ai_models (
                ai_model_id, model_name, description, provider,
                version_number, tenant_id, no_of_associated_agents,
                created_ts, updated_ts
            )
            SELECT
                ai_model_id, model_name, description, provider,
                version_number, tenant_id, 0,
                now_ts, now_ts
            FROM ({union_all}) AS s
            ON CONFLICT (ai_model_id) DO UPDATE SET
                model_name     = COALESCE(NULLIF(EXCLUDED.model_name, ''), ai_models.model_name),
                description    = COALESCE(EXCLUDED.description, ai_models.description),
                provider       = COALESCE(EXCLUDED.provider, ai_models.provider),
                version_number = COALESCE(EXCLUDED.version_number, ai_models.version_number),
                tenant_id      = COALESCE(EXCLUDED.tenant_id, ai_models.tenant_id),
                updated_ts     = EXCLUDED.updated_ts
        """, label="linked ai_models upsert")
        logger.info("AICT inbound: upserted %d linked AI model(s) into core.ai_models", len(models))

    def execute(self):
        print("Running AICT Inbound Connector")
        self.validate_config()
        self.authenticate()

        bots, standalone_models = self.fetch_metadata()

        if not bots and not standalone_models:
            print("No AICT assets found")
            return

        print(f"Found {len(bots)} agent(s) and {len(standalone_models)} standalone model(s)")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with open(template_path, "r", encoding="utf-8") as fh:
            template = json.load(fh)

        init_pool()

        agent_cards = transform_to_agent_cards(
            bots,
            {"agent_id_map": {}},
            template,
            "aict_inbound",
        )

        for card, bot in zip(agent_cards, bots):
            card_data = card.get("data", {})

            # Map agent fields from AICT API response
            card_data.setdefault("provider", {})["organization"] = bot["provider_name"]
            card_data["version"] = bot.get("version") or ""

            if bot.get("ai_model"):
                # TavroAgentCard.AIModel forbids extra fields — strip provider/version for validation.
                # Full model data is upserted into core.ai_models separately after process_card.
                card_data["ai_model"] = [
                    {"name": m.get("name"), "description": _clean_html(m.get("description"))}
                    for m in bot["ai_model"]
                ]
            if bot.get("tool"):
                card_data["tool"] = bot["tool"]

        for agent, bot in zip(agent_cards, bots):
            agent_name = agent.get("data", {}).get("name", "?")
            agent_id = agent.get("data", {}).get("identification", {}).get("agent_id", "?")
            logger.info("AICT inbound: calling process_card for '%s' (agent_id=%s)", agent_name, agent_id)
            try:
                process_card(agent["data"])
                logger.info("AICT inbound: process_card succeeded for '%s'", agent_name)
            except Exception as e:
                logger.error("AICT inbound: process_card FAILED for '%s' (agent_id=%s) — %s", agent_name, agent_id, e, exc_info=True)
                continue

            # Upsert full model metadata (provider, version) into core.ai_models for linked models.
            # Read tenant_id from the agent row process_card just wrote — it has the correct
            # value injected by the admin portal's process_card monkey-patch.
            linked_models = [m for m in (bot.get("ai_model") or []) if m.get("name")]
            if linked_models:
                tid_rows = execute_query(
                    f"SELECT tenant_id FROM core.agents WHERE agent_id = '{bot['botid']}' AND is_current = true LIMIT 1"
                )
                agent_tenant_id = (tid_rows[0]["tenant_id"] if tid_rows else None) or TENANT_ID or None
                self._upsert_linked_ai_models(linked_models, tenant_id=agent_tenant_id)

        # Link parent → child via parent_agent_internal_id on child row
        for bot in bots:
            if not bot.get("child_agents"):
                continue

            # Get parent's agent_internal_id from DB
            rows = execute_query(
                f"SELECT agent_internal_id FROM core.agents WHERE agent_id = '{bot['botid']}' LIMIT 1"
            )
            if not rows:
                logger.warning("AICT inbound: could not find agent in DB for agent_id='%s' (name='%s') — skipping child linking", bot['botid'], bot.get('name'))
                continue
            parent_internal_id = rows[0]["agent_internal_id"]
            logger.info("AICT inbound: linking %d child(ren) of '%s' (internal_id=%s)", len(bot['child_agents']), bot.get('name'), parent_internal_id)

            # Create child agents and set parent pointer
            child_cards = transform_to_agent_cards(
                bot["child_agents"],
                {"agent_id_map": {}},
                template,
                "aict_inbound",
            )
            for child_card, child_bot in zip(child_cards, bot["child_agents"]):
                child_card.get("data", {}).setdefault("provider", {})["organization"] = bot["provider_name"]
                child_name = child_card.get("data", {}).get("name", "?")
                child_agent_id = child_card.get("data", {}).get("identification", {}).get("agent_id", "?")
                logger.info("AICT inbound: calling process_card for child '%s' (agent_id=%s)", child_name, child_agent_id)
                try:
                    process_card(child_card["data"])
                    logger.info("AICT inbound: process_card succeeded for child '%s'", child_name)
                except Exception as e:
                    logger.error("AICT inbound: process_card FAILED for child '%s' (agent_id=%s) — %s", child_name, child_agent_id, e, exc_info=True)
                    continue

                child_rows = execute_query(
                    f"SELECT agent_internal_id FROM core.agents WHERE agent_id = '{child_bot['botid']}' LIMIT 1"
                )
                if not child_rows:
                    continue
                child_internal_id = child_rows[0]["agent_internal_id"]

                execute_dml(
                    f"""
                    UPDATE core.agents
                    SET parent_agent_internal_id = '{parent_internal_id}',
                        updated_ts = CURRENT_TIMESTAMP
                    WHERE agent_internal_id = '{child_internal_id}'
                    """
                )

        # Upsert standalone AI models directly into core.ai_models
        if standalone_models:
            from datetime import datetime, timezone
            now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            # Resolve tenant_id from any agent already in the DB for this run,
            # so standalone models get the same tenant_id injected by the admin portal.
            tid_rows = execute_query(
                "SELECT tenant_id FROM core.agents WHERE is_current = true AND tenant_id IS NOT NULL LIMIT 1"
            )
            tenant_id = (tid_rows[0]["tenant_id"] if tid_rows else None) or TENANT_ID or None
            select_rows = []
            for m in standalone_models:
                select_rows.append(f"""
                    SELECT
                        md5(lower(trim({_sq(m['name'])})))  AS ai_model_id,
                        {_sq(m['name'])}                    AS model_name,
                        {_sq(m['description'])}             AS description,
                        {_sq(m.get('provider'))}            AS provider,
                        {_sq(m['version'])}                 AS version_number,
                        {_sq(tenant_id)}                    AS tenant_id,
                        TIMESTAMP '{now_str}'               AS now_ts
                    WHERE NULLIF(trim({_sq(m['name'])}), '') IS NOT NULL
                """.strip())
            union_all = "\nUNION ALL\n".join(select_rows)
            execute_dml(f"""
                INSERT INTO core.ai_models (
                    ai_model_id, model_name, description, provider,
                    version_number, tenant_id, no_of_associated_agents,
                    created_ts, updated_ts
                )
                SELECT
                    ai_model_id, model_name, description, provider,
                    version_number, tenant_id, 0,
                    now_ts, now_ts
                FROM ({union_all}) AS s
                ON CONFLICT (ai_model_id) DO UPDATE SET
                    model_name     = COALESCE(NULLIF(EXCLUDED.model_name, ''), ai_models.model_name),
                    description    = COALESCE(EXCLUDED.description, ai_models.description),
                    provider       = COALESCE(EXCLUDED.provider, ai_models.provider),
                    version_number = COALESCE(EXCLUDED.version_number, ai_models.version_number),
                    tenant_id      = COALESCE(EXCLUDED.tenant_id, ai_models.tenant_id),
                    updated_ts     = EXCLUDED.updated_ts
            """, label="standalone ai_models upsert")
            print(f"Upserted {len(standalone_models)} standalone AI model(s) into core.ai_models")

        print("AICT inbound execution completed successfully")
