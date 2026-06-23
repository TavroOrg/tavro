"""
AICT Inbound Connector — 3-hop chain to import agents + linked AI models
from ServiceNow AICT into the Tavro agent catalog.

Agent flow:
  1. sn_ai_governance_asset_governance_details  (recent 5, newest first)
       └─ asset.value
  2. alm_ai_system_digital_asset/{asset_sys_id}
       └─ model.value, ai_models.value (comma-separated sys_ids)
  3. cmdb_ai_system_component_product_model/{model_sys_id}
       └─ name, description  → agent name / description

AI model flow (per ai_model sys_id from step 2):
  4. alm_ai_model_digital_asset/{ai_model_sys_id}
       └─ model.value
  5. cmdb_ai_model_product_model/{model_sys_id}
       └─ name, description  → linked to agent as ai_model
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import requests

from .base_connector import BaseConnector
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card

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

    def _get(self, table: str, sys_id: str = "", params: dict | None = None) -> dict | list:
        url = f"{self.instance_url}/api/now/table/{table}"
        if sys_id:
            url = f"{url}/{sys_id}"
        resp = requests.get(
            url,
            auth=self.auth,
            headers=_HEADERS,
            params=params or {},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("result", {} if sys_id else [])

    def _fetch_tools(self, asset_sys_id: str) -> list[dict]:
        """
        sn_ent_ai_system_subcomponent_m2m (filter: ai_system=asset_sys_id, table=sn_ent_ai_tool)
          └─ ai_subcomponent.value
        sn_ent_ai_tool/{subcomponent_sys_id}
          └─ name, description
        """
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

            description = (
                tool_rec.get("description") or
                tool_rec.get("short_description") or ""
            ).strip()

            tools.append({
                "identifier":          tool_sys_id,
                "name":                name,
                "description":         description,
                "delegation_possible": "false",
                "allowed_delegates":   None,
                "parameter_name":      None,
                "parameter_type":      None,
                "default_value":       None,
                "input_schema":        None,
                "output_schema":       None,
            })

        return tools

    def _fetch_ai_models(self, ai_model_sys_ids: list[str]) -> list[dict]:
        """
        For each sys_id from alm_ai_system_digital_asset.ai_models:
          alm_ai_model_digital_asset/{id} → model.value
          cmdb_ai_model_product_model/{model_id} → name, description
        """
        ai_models = []
        for sys_id in ai_model_sys_ids:
            sys_id = sys_id.strip()
            if not sys_id:
                continue
            try:
                model_asset = self._get(
                    "alm_ai_model_digital_asset",
                    sys_id=sys_id,
                    params={"sysparm_fields": "model", "sysparm_display_value": "all"},
                )
                model_sys_id = (model_asset.get("model") or {}).get("value", "").strip()
                if not model_sys_id:
                    continue

                product_model = self._get(
                    "cmdb_ai_model_product_model",
                    sys_id=model_sys_id,
                    params={"sysparm_fields": "name,description,short_description", "sysparm_display_value": "false"},
                )
                name = (product_model.get("name") or "").strip()
                if not name:
                    continue

                description = (
                    product_model.get("description") or
                    product_model.get("short_description") or ""
                ).strip()

                ai_models.append({
                    "name":        name,
                    "description": description,
                })
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not resolve ai_model %s — %s", sys_id, e)

        return ai_models

    def fetch_metadata(self) -> list[dict]:
        # Step 1 — get recent governance detail records (fetch 20, cap at 5 resolved)
        governance_records = self._get(
            "sn_ai_governance_asset_governance_details",
            params={
                "sysparm_fields":        "sys_id,asset",
                "sysparm_display_value": "all",
                "sysparm_limit":         20,
                "sysparm_query":         "ORDERBYDESCsys_created_on",
            },
        )

        bots = []
        for gov in governance_records:
            if len(bots) >= 5:
                break

            gov_sys_id = (gov.get("sys_id") or {})
            gov_sys_id = gov_sys_id.get("value", "") if isinstance(gov_sys_id, dict) else gov_sys_id
            gov_sys_id = gov_sys_id.strip()

            asset_sys_id = (gov.get("asset") or {}).get("value", "").strip()
            if not asset_sys_id:
                continue

            # Step 2 — get digital asset → model sys_id + ai_models list
            try:
                digital_asset = self._get(
                    "alm_ai_system_digital_asset",
                    sys_id=asset_sys_id,
                    params={
                        "sysparm_fields":        "sys_id,model,ai_models",
                        "sysparm_display_value": "all",
                    },
                )
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch digital asset %s — %s", asset_sys_id, e)
                continue

            model_sys_id = (digital_asset.get("model") or {}).get("value", "").strip()
            if not model_sys_id:
                continue

            # Step 3 — get agent name + description from product model
            try:
                product_model = self._get(
                    "cmdb_ai_system_component_product_model",
                    sys_id=model_sys_id,
                    params={"sysparm_fields": "name,description", "sysparm_display_value": "false"},
                )
            except requests.HTTPError as e:
                logger.warning("AICT inbound: could not fetch product model %s — %s", model_sys_id, e)
                continue

            name = (product_model.get("name") or "").strip()
            if not name:
                continue

            # Steps 4+5 — resolve linked AI models
            raw_ai_models = (digital_asset.get("ai_models") or {}).get("value", "")
            ai_model_sys_ids = [s.strip() for s in raw_ai_models.split(",") if s.strip()]
            ai_models = self._fetch_ai_models(ai_model_sys_ids) if ai_model_sys_ids else []

            # Step 6 — resolve linked tools via sn_ent_ai_system_subcomponent_m2m
            tools = self._fetch_tools(asset_sys_id)

            bots.append({
                "botid":       gov_sys_id,
                "name":        name,
                "description": (product_model.get("description") or "").strip(),
                "instruction": "",
                "ai_model":    ai_models,
                "tool":        tools,
            })

        return bots

    def normalize(self, bots: list[dict]) -> list[dict]:
        return bots

    def execute(self):
        print("Running AICT Inbound Connector")
        self.validate_config()
        self.authenticate()

        bots = self.fetch_metadata()

        if not bots:
            print("No AICT agents found")
            return

        print(f"Found {len(bots)} AICT agent(s) — upserting into portal")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with open(template_path, "r", encoding="utf-8") as fh:
            template = json.load(fh)

        agent_cards = transform_to_agent_cards(
            bots,
            {"agent_id_map": {}},
            template,
            "aict_inbound",
        )

        for card, bot in zip(agent_cards, bots):
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})["organization"] = "ServiceNow AICT"
            if bot.get("ai_model"):
                card_data["ai_model"] = bot["ai_model"]
            if bot.get("tool"):
                card_data["tool"] = bot["tool"]

        init_pool()
        for agent in agent_cards:
            process_card(agent["data"])

        print("AICT inbound execution completed successfully")
