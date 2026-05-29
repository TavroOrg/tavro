import json
import os
from pathlib import Path

import requests

from .base_connector import BaseConnector
from utils.db import DATABASE_URL
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card


class SnowflakeConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.account = (config.get("account") or "").rstrip("/")
        self.database = config.get("database")
        self.schema = config.get("schema")
        self.token = config.get("token")
        self.base_url = ""
        self.headers = {}

    def get_pg_dsn(self):
        return DATABASE_URL

    def validate_config(self):
        required = ["account", "database", "schema", "token"]
        missing = [key for key in required if not self.config.get(key)]
        if missing:
            raise ValueError(
                "Missing snowflake config keys: " + ", ".join(missing)
            )

    def authenticate(self):
        self.base_url = (
            f"{self.account}/api/v2/databases/{self.database}/schemas/{self.schema}"
        )
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def fetch_metadata(self):
        print("Fetching Snowflake agents...")
        url = f"{self.base_url}/agents"
        response = requests.get(url, headers=self.headers, timeout=30)

        if response.status_code != 200:
            raise Exception(response.text)

        data = response.json()
        if isinstance(data, dict):
            return data.get("agents", [])
        if isinstance(data, list):
            return data
        return []

    def fetch_agent_details(self, agent_name):
        url = f"{self.base_url}/agents/{agent_name}"
        response = requests.get(url, headers=self.headers, timeout=30)

        if response.status_code != 200:
            return {}

        data = response.json()
        if isinstance(data.get("agent_spec"), str):
            try:
                data["agent_spec"] = json.loads(data["agent_spec"])
            except Exception:
                pass

        return data

    def normalize(self, agents):
        output = []

        for agent in agents:
            name = agent.get("name")
            if not name:
                continue

            detail = self.fetch_agent_details(name)
            spec = detail.get("agent_spec", {})
            description = detail.get("comment") or detail.get("description")

            instructions = spec.get("instructions", {})
            combined_instruction = {
                "response": instructions.get("response"),
                "orchestration": instructions.get("orchestration"),
            }

            model_name = spec.get("models", {}).get("orchestration")
            llm_model = None
            if model_name:
                llm_model = [
                    {
                        "name": model_name,
                        "version_number": None,
                    }
                ]

            tools = []
            for tool in spec.get("tools", []):
                tool_spec = tool.get("tool_spec", {})
                tool_name = tool_spec.get("name")
                tool_resources = spec.get("tool_resources", {})
                resource = tool_resources.get(tool_name, {})

                tools.append(
                    {
                        "identifier": resource.get("name") or resource.get("identifier"),
                        "name": tool_name,
                        "description": tool_spec.get("description"),
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": tool_spec.get("type"),
                        "default_value": None,
                        "input_schema": tool_spec.get("input_schema"),
                        "output_schema": None,
                    }
                )

            knowledge_source = None
            for _, resource in spec.get("tool_resources", {}).items():
                if resource.get("semantic_model_file"):
                    knowledge_source = {
                        "id": None,
                        "name": resource.get("semantic_model_file").split("/")[-1],
                    }

            bot_obj = {
                "botid": name,
                "name": name,
                "description": description,
                "instruction": json.dumps(combined_instruction),
                "tool": tools,
                "llm_model": llm_model,
                "knowledge_source": knowledge_source,
                "owner": detail.get("owner"),
                "account": self.account,
            }

            output.append(bot_obj)

        return output

    def execute(self):
        print("Running Snowflake Connector")
        self.validate_config()
        self.authenticate()

        agents = self.fetch_metadata()
        bots = self.normalize(agents)
        print(f"Found {len(bots)} bots")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {},
            template,
            "snowflake",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "Snowflake"

        init_pool()
        for agent in agent_cards:
            process_card(agent["data"])

        print("Snowflake execution completed successfully")
