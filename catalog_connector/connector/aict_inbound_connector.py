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

from .base_connector import BaseConnector
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card, execute_query, execute_dml

def _sq(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

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
        resp = requests.get(url, auth=self.auth, headers=_HEADERS, params=params or {}, timeout=60)
        resp.raise_for_status()
        return resp.json().get("result", {} if sys_id else [])

    # ── AICT REST API (used for ai_system and ai_model) ──────────────────────────

    def _get_aict(self, resource: str, sys_id: str) -> dict:
        url = f"{self.instance_url}/api/sn_ent/asset/{resource}/{sys_id}"
        resp = requests.get(url, auth=self.auth, headers=_HEADERS, timeout=60)
        resp.raise_for_status()
        return resp.json().get("result", {})

    # ── AI Models ─────────────────────────────────────────────────────────────────

    def _fetch_ai_models(self, ai_model_sys_ids: list[dict]) -> list[dict]:
        """
        For each {sys_id, name} from ai_system.ai_models:
          GET /api/sn_ent/asset/ai_model/{sys_id}
            └─ name, description, provider.name → linked to agent
        """
        ai_models = []
        for entry in ai_model_sys_ids:
            sys_id = (entry.get("sys_id") or "").strip()
            if not sys_id:
                continue
            try:
                model = self._get_aict("ai_model", sys_id)
                name = (model.get("name") or "").strip()
                if not name:
                    continue
                ai_models.append({
                    "name":        name,
                    "description": (model.get("description") or "").strip(),
                    "provider":    (model.get("provider") or {}).get("name") or "",
                    "version":     model.get("version") or "",
                })
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch ai_model %s — %s", sys_id, e)

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
        except requests.HTTPError as e:
            logger.warning("AICT inbound: could not fetch subcomponents for %s — %s", asset_sys_id, e)
            return tools

        for rec in m2m_records:
            ref_table = (rec.get("ai_subcomponent_reference_table") or {}).get("value", "").strip()
            if ref_table != "sn_ent_ai_tool":
                continue

            tool_sys_id = (rec.get("ai_subcomponent") or {}).get("value", "").strip()
            if not tool_sys_id:
                continue

            try:
                tool_rec = self._get(
                    "sn_ent_ai_tool",
                    sys_id=tool_sys_id,
                    params={"sysparm_fields": "name,description,short_description", "sysparm_display_value": "false"},
                )
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch tool %s — %s", tool_sys_id, e)
                continue

            name = (tool_rec.get("name") or "").strip()
            if not name:
                continue

            tools.append({
                "identifier":          tool_sys_id,
                "name":                name,
                "description":         (tool_rec.get("description") or tool_rec.get("short_description") or "").strip(),
                "delegation_possible": "false",
                "allowed_delegates":   None,
                "parameter_name":      None,
                "parameter_type":      None,
                "default_value":       None,
                "input_schema":        None,
                "output_schema":       None,
            })

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
        except requests.HTTPError as e:
            logger.warning("AICT inbound: could not fetch child agents for %s — %s", asset_sys_id, e)
            return children

        for rec in m2m_records:
            child_asset_sys_id = (rec.get("ai_subcomponent") or {}).get("value", "").strip()
            if not child_asset_sys_id:
                continue
            try:
                child = self._get_aict("ai_system", child_asset_sys_id)
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch child ai_system %s — %s", child_asset_sys_id, e)
                continue

            child_name = (child.get("name") or "").strip()
            if not child_name:
                continue

            children.append({
                "botid":       child_asset_sys_id,
                "name":        child_name,
                "description": (child.get("description") or "").strip(),
                "instruction": "",
                "ai_model":    [],
                "tool":        [],
            })

        return children

    # ── Main fetch ────────────────────────────────────────────────────────────────

    def fetch_metadata(self) -> list[dict]:
        # Step 1 — governance records (entry point)
        governance_records = self._get(
            "sn_ai_governance_asset_governance_details",
            params={
                "sysparm_fields":        "sys_id,asset",
                "sysparm_display_value": "all",
                "sysparm_limit":         200,
                "sysparm_query":         "ORDERBYDESCsys_created_on",
            },
        )

        bots = []
        standalone_models = []
        seen_assets = set()

        for gov in governance_records:

            if len(bots) >= 5 and len(standalone_models) >= 5:
                break

            gov_sys_id = gov.get("sys_id") or {}
            gov_sys_id = gov_sys_id.get("value", "") if isinstance(gov_sys_id, dict) else gov_sys_id
            gov_sys_id = gov_sys_id.strip()

            asset_sys_id = (gov.get("asset") or {}).get("value", "").strip()
            if not asset_sys_id:
                continue

            # skip duplicate assets (same asset can appear in multiple governance records)
            if asset_sys_id in seen_assets:
                continue
            seen_assets.add(asset_sys_id)

            # Step 2 — check asset type before routing to the correct AICT API
            try:
                asset_meta = self._get(
                    "alm_ai_digital_asset",
                    sys_id=asset_sys_id,
                    params={"sysparm_fields": "sys_class_name", "sysparm_display_value": "all"},
                )
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch asset type for %s — %s", asset_sys_id, e)
                continue

            asset_class = (asset_meta.get("sys_class_name") or {}).get("value", "").strip()

            if asset_class == "alm_ai_system_digital_asset":
                if len(bots) >= 5:
                    continue
                # Full agent flow — fetch from ai_system API
                try:
                    ai_system = self._get_aict("ai_system", asset_sys_id)
                except requests.HTTPError as e:
                    logger.warning("AICT inbound: could not fetch ai_system %s — %s", asset_sys_id, e)
                    continue

                name = (ai_system.get("name") or "").strip()
                if not name:
                    continue

                provider_name = (ai_system.get("provider") or {}).get("name") or "ServiceNow AICT"

                # Resolve instruction from ai_prompts where name contains "instruction"
                instruction = ""
                for prompt_entry in (ai_system.get("ai_prompts") or []):
                    prompt_name = (prompt_entry.get("name") or "").lower()
                    if "instruction" in prompt_name:
                        prompt_sys_id = (prompt_entry.get("sys_id") or "").strip()
                        if prompt_sys_id:
                            try:
                                prompt_rec = self._get_aict("ai_prompt", prompt_sys_id)
                                instruction = (prompt_rec.get("prompt_info") or "").strip()
                            except requests.HTTPError as e:
                                logger.warning("AICT inbound: could not fetch ai_prompt %s — %s", prompt_sys_id, e)
                        break

                ai_models = self._fetch_ai_models(ai_system.get("ai_models") or [])
                tools = self._fetch_tools(asset_sys_id)
                child_agents = self._fetch_child_agents(asset_sys_id)

                bots.append({
                    "botid":         gov_sys_id,
                    "name":          name,
                    "description":   (ai_system.get("description") or "").strip(),
                    "instruction":   instruction,
                    "version":       ai_system.get("version") or "",
                    "provider_name": provider_name,
                    "ai_model":      ai_models,
                    "tool":          tools,
                    "child_agents":  child_agents,
                })
                time.sleep(1)

            elif asset_class == "alm_ai_model_digital_asset":
                if len(standalone_models) >= 5:
                    continue
                # Model asset flow — fetch from ai_model API, store in standalone_models
                try:
                    ai_model = self._get_aict("ai_model", asset_sys_id)
                except requests.HTTPError as e:
                    logger.warning("AICT inbound: could not fetch ai_model %s — %s", asset_sys_id, e)
                    continue

                name = (ai_model.get("name") or "").strip()
                if not name:
                    continue

                standalone_models.append({
                    "name":        name,
                    "description": (ai_model.get("description") or "").strip(),
                    "version":     ai_model.get("version") or "",
                    "provider":    (ai_model.get("provider") or {}).get("name") or "ServiceNow AICT",
                })

            else:
                logger.info(
                    "AICT inbound: skipping asset %s — unhandled class '%s'",
                    asset_sys_id, asset_class,
                )

        return bots, standalone_models

    def normalize(self, bots: list[dict]) -> list[dict]:
        return bots

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
                card_data["ai_model"] = bot["ai_model"]
            if bot.get("tool"):
                card_data["tool"] = bot["tool"]

        for agent in agent_cards:
            process_card(agent["data"])

        # Link parent → child via parent_agent_internal_id on child row
        for bot in bots:
            if not bot.get("child_agents"):
                continue

            # Get parent's agent_internal_id from DB
            rows = execute_query(
                f"SELECT agent_internal_id FROM core.agents WHERE agent_id = '{bot['botid']}' LIMIT 1"
            )
            if not rows:
                continue
            parent_internal_id = rows[0]["agent_internal_id"]

            # Create child agents and set parent pointer
            child_cards = transform_to_agent_cards(
                bot["child_agents"],
                {"agent_id_map": {}},
                template,
                "aict_inbound",
            )
            for child_card, child_bot in zip(child_cards, bot["child_agents"]):
                child_card.get("data", {}).setdefault("provider", {})["organization"] = bot["provider_name"]
                process_card(child_card["data"])

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
            select_rows = []
            for m in standalone_models:
                select_rows.append(f"""
                    SELECT
                        md5(lower(trim({_sq(m['name'])})))  AS ai_model_id,
                        {_sq(m['name'])}                    AS model_name,
                        {_sq(m['description'])}             AS description,
                        {_sq(m['provider'])}                AS provider,
                        {_sq(m['version'])}                 AS version_number,
                        TIMESTAMP '{now_str}'               AS now_ts
                    WHERE NULLIF(trim({_sq(m['name'])}), '') IS NOT NULL
                """.strip())
            union_all = "\nUNION ALL\n".join(select_rows)
            execute_dml(f"""
                INSERT INTO core.ai_models (
                    ai_model_id, model_name, description, provider,
                    version_number, no_of_associated_agents,
                    created_ts, updated_ts
                )
                SELECT
                    ai_model_id, model_name, description, provider,
                    version_number, 0,
                    now_ts, now_ts
                FROM ({union_all}) AS s
                ON CONFLICT (ai_model_id) DO UPDATE SET
                    model_name     = COALESCE(NULLIF(EXCLUDED.model_name, ''), ai_models.model_name),
                    description    = COALESCE(EXCLUDED.description, ai_models.description),
                    provider       = COALESCE(EXCLUDED.provider, ai_models.provider),
                    version_number = COALESCE(EXCLUDED.version_number, ai_models.version_number),
                    updated_ts     = EXCLUDED.updated_ts
            """, label="standalone ai_models upsert")
            print(f"Upserted {len(standalone_models)} standalone AI model(s) into core.ai_models")

        print("AICT inbound execution completed successfully")
