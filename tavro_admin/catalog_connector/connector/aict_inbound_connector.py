"""
AICT Inbound Connector — polls ServiceNow AICT for AI governance assets
and imports them as agents into the Tavro portal.

Table: cmdb_ai_system_component_product_model
Field mapping:
  name        → agent name
  description → agent description
  sys_id      → agent_id (stable identifier)

Incremental sync: only records created after the last successful run are
fetched. The last-run timestamp is persisted in aict_inbound_state.json
next to this file.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import requests

from catalog_connector.connector.base_connector import BaseConnector
from catalog_connector.save import save_agent_cards
from catalog_connector.transformers.agent_transformer import transform_to_agent_cards

logger = logging.getLogger(__name__)

_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}

AICT_TABLE  = "cmdb_ai_system_component_product_model"
_STATE_FILE = Path(__file__).resolve().parent / "aict_inbound_state.json"

# ServiceNow datetime format used in sysparm_query
_SN_DT_FMT = "%Y-%m-%d %H:%M:%S"


def _load_last_run() -> str | None:
    """Return the stored last-run timestamp string, or None if first run."""
    if _STATE_FILE.exists():
        try:
            data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
            return data.get("last_run")
        except Exception:
            pass
    return None


def _save_last_run(ts: str) -> None:
    _STATE_FILE.write_text(json.dumps({"last_run": ts}), encoding="utf-8")


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

    def fetch_metadata(self, since: str | None) -> list[dict]:
        url = f"{self.instance_url}/api/now/table/{AICT_TABLE}"

        query = f"sys_created_on>{since}" if since else ""

        params = {
            "sysparm_fields":        "sys_id,name,description",
            "sysparm_display_value": "false",
            "sysparm_limit":         5,
            "sysparm_query":         (query + "^" if query else "") + "ORDERBYDESCsys_created_on",
        }
        resp = requests.get(
            url,
            auth=self.auth,
            headers=_HEADERS,
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        records = resp.json().get("result", [])

        if since:
            logger.info("AICT inbound: fetched %d new records created after %s", len(records), since)
        else:
            logger.info("AICT inbound: first run — fetched %d records", len(records))

        return records

    def normalize(self, records: list[dict]) -> list[dict]:
        bots = []
        for rec in records:
            sys_id = rec.get("sys_id", "")
            name = (rec.get("name") or "").strip()
            description = (rec.get("description") or "").strip()

            if not name:
                logger.debug("AICT inbound: skipping record %s — no name", sys_id)
                continue

            bots.append({
                "botid":       sys_id,
                "name":        name,
                "description": description,
                "instruction": "",
            })

        return bots

    def execute(self):
        print("Running AICT Inbound Connector")
        self.validate_config()
        self.authenticate()

        last_run = _load_last_run()
        run_time = datetime.now(timezone.utc).strftime(_SN_DT_FMT)

        records = self.fetch_metadata(since=last_run)
        bots = self.normalize(records)

        if not bots:
            print("No new AICT agents since last run")
            _save_last_run(run_time)
            return

        print(f"Found {len(bots)} new AICT agent(s)")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with open(template_path, "r", encoding="utf-8") as fh:
            template = json.load(fh)

        agent_cards = transform_to_agent_cards(
            bots,
            {"agent_id_map": {}},
            template,
            "aict_inbound",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "ServiceNow AICT"

        save_agent_cards("aict_inbound", agent_cards)

        _save_last_run(run_time)
        print("AICT inbound execution completed successfully")
