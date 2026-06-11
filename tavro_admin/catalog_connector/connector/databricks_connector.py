import json
import logging
import os
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .base_connector import BaseConnector
# from utils.config_loader import load_config
from ..transformers.agent_transformer import transform_to_agent_cards
# from worker import init_pool, process_card
from save import save_agent_cards

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DatabricksConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.workspace_url = (config.get("workspace_url") or "").rstrip("/")
        self.token = config.get("databricks_token")
        self.base_url = f"{self.workspace_url}/api/2.0" if self.workspace_url else ""
        self.session = None

        # full_config = load_config()
        # self.postgres_config = full_config.get("postgres", {})

    # def get_postgres_config(self):
    #     required_keys = [
    #         "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER",
    #         "POSTGRES_PASSWORD", "POSTGRES_DB",
    #     ]
    #     missing_keys = [key for key in required_keys if not self.postgres_config.get(key)]
    #     if missing_keys:
    #         raise ValueError("Missing postgres config keys: " + ", ".join(missing_keys))
    #     return self.postgres_config

    # def get_pg_dsn(self):
    #     postgres_config = self.get_postgres_config()
    #     return (
    #         f"postgresql://{postgres_config['POSTGRES_USER']}:"
    #         f"{postgres_config['POSTGRES_PASSWORD']}@"
    #         f"{postgres_config['POSTGRES_HOST']}:"
    #         f"{postgres_config['POSTGRES_PORT']}/"
    #         f"{postgres_config['POSTGRES_DB']}"
    #     )

    def validate_config(self):
        required = ["workspace_url", "databricks_token"]
        missing = [key for key in required if not self.config.get(key)]
        if missing:
            raise ValueError(
                "Missing databricks config keys: " + ", ".join(missing)
            )

    def authenticate(self):
        self.session = self._get_session()

    def _get_session(self):
        session = requests.Session()
        session.headers.update(
            {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            }
        )

        retries = Retry(
            total=3,
            backoff_factor=0.3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
        )
        session.mount("https://", HTTPAdapter(max_retries=retries))
        return session

    def _get(self, path):
        url = f"{self.base_url}{path}"
        response = self.session.get(url, timeout=30)
        if response.status_code != 200:
            logger.error("GET failed: %s - %s", url, response.text)
            return {}
        return response.json()

    def fetch_metadata(self):
        print("Fetching Databricks agents...")

        data = self._get("/serving-endpoints")
        endpoints = data.get("endpoints", [])
        results = []

        for endpoint in endpoints:
            name = endpoint.get("name")
            if not name:
                continue

            if not name.lower().endswith("-endpoint"):
                continue

            details = self._get(f"/serving-endpoints/{name}")
            if details:
                results.append(details)

        logger.info("Final agents count: %s", len(results))
        return results

    def normalize(self, data):
        output = []

        for meta in data:
            bot_obj = {
                "botid": meta.get("id"),
                "name": meta.get("name"),
                "description": meta.get("description") or "",
                "workspace_url": self.workspace_url,
            }

            creator = meta.get("creator") or meta.get("creator_user_name")
            if creator:
                bot_obj["owner"] = creator

            state = meta.get("state")
            if isinstance(state, dict) and state.get("ready"):
                bot_obj["governance_status"] = state.get("ready")

            if meta.get("permission_level"):
                bot_obj["access_scope"] = meta.get("permission_level")

            served = meta.get("config", {}).get("served_entities", [])
            models = []
            for entity in served:
                foundation_model = entity.get("foundation_model") or {}
                if foundation_model.get("name"):
                    models.append(
                        {
                            "name": foundation_model.get("name"),
                            "owner": None,
                            "department_executive": None,
                            "description": None,
                        }
                    )

            if models:
                bot_obj["ai_model"] = models

            if meta.get("id"):
                bot_obj["version"] = meta.get("id")

            output.append(bot_obj)

        return output

    def execute(self):
        print("Running Databricks Connector")
        self.validate_config()
        self.authenticate()

        raw_data = self.fetch_metadata()
        if not raw_data:
            print("No Databricks agents found")
            return

        bots = self.normalize(raw_data)
        print(f"Found {len(bots)} bots")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {},
            template,
            "databricks",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "Databricks"

        # Save to extracted_json/databricks/ instead of DB
        # if not os.getenv("PG_DSN"):
        #     os.environ["PG_DSN"] = self.get_pg_dsn()
        # init_pool()
        # for agent in agent_cards:
        #     process_card(agent["data"])
        save_agent_cards("databricks", agent_cards)

        print("Databricks execution completed successfully")
