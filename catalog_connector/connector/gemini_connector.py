import json
import os
from pathlib import Path

import requests
from google_auth_oauthlib.flow import InstalledAppFlow

from .base_connector import BaseConnector
from utils.db import DATABASE_URL
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card


class GeminiConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.token = None
        self.location = config.get("location", "global")

    def get_pg_dsn(self):
        return DATABASE_URL

    def validate_config(self):
        required_keys = [
            "client_id",
            "client_secret",
            "project_id",
            "collection_id",
            "engine_id",
            "auth_uri",
            "token_uri",
        ]
        missing_keys = [key for key in required_keys if not self.config.get(key)]
        if missing_keys:
            raise ValueError(
                "Missing gemini config keys: " + ", ".join(missing_keys)
            )

    def authenticate(self):
        print("Running Gemini OAuth flow...")

        flow = InstalledAppFlow.from_client_config(
            {
                "installed": {
                    "client_id": self.config["client_id"],
                    "client_secret": self.config["client_secret"],
                    "auth_uri": self.config["auth_uri"],
                    "token_uri": self.config["token_uri"],
                }
            },
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
            redirect_uri="https://localhost/auth/callback",
        )

        auth_url, _ = flow.authorization_url(prompt="consent")
        print("\nOpen this URL in browser:\n")
        print(auth_url)

        code = input("\nPaste the authorization code here: ").strip()
        flow.fetch_token(code=code)
        self.token = flow.credentials.token

        print("Gemini OAuth authentication successful")

    def fetch_metadata(self):
        parent = (
            f"projects/{self.config['project_id']}/locations/{self.location}"
            f"/collections/{self.config['collection_id']}"
            f"/engines/{self.config['engine_id']}"
            f"/assistants/default_assistant"
        )
        url = f"https://discoveryengine.googleapis.com/v1alpha/{parent}/agents"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        response = requests.get(url, headers=headers, timeout=30)
        if response.status_code != 200:
            raise Exception(response.text)

        data = response.json()
        agents = data.get("agents", [])
        normalized = []

        for agent in agents:
            instruction = ""
            subagents = []
            tools = []

            if "a2aAgentDefinition" in agent:
                a2a_def = agent.get("a2aAgentDefinition", {})
                json_card = a2a_def.get("jsonAgentCard")

                if isinstance(json_card, str):
                    try:
                        json_card = json.loads(json_card)
                    except ValueError:
                        json_card = {}

                if isinstance(json_card, dict):
                    normalized.append(
                        {
                            "botid": agent.get("name"),
                            "name": json_card.get("name"),
                            "description": json_card.get("description"),
                            "instruction": json_card.get("description"),
                            "tool": [],
                            "subagents": [],
                            "skills": json_card.get("skills", []),
                            "raw_agent_card": json_card,
                        }
                    )
                    continue

            elif "adkAgentDefinition" in agent:
                normalized.append(
                    {
                        "botid": agent.get("name"),
                        "name": agent.get("displayName"),
                        "description": agent.get("description"),
                        "instruction": agent.get("description"),
                        "tool": [{"name": "googleSearch"}],
                        "subagents": [],
                        "skills": [],
                    }
                )
                continue

            elif "lowCodeAgentDefinition" in agent:
                low_code = agent.get("lowCodeAgentDefinition", {})
                nodes = low_code.get("nodes", [])

                for node in nodes:
                    if node.get("id") != "root_agent":
                        continue
                    llm = node.get("llmAgentNode", {})
                    instruction = llm.get("instruction", "")
                    subagents = llm.get("subAgentIds", [])
                    selected_tools = llm.get("selectedTools", {})
                    tools = selected_tools.get("tool", [])
                    break

            normalized.append(
                {
                    "botid": agent.get("name"),
                    "name": agent.get("displayName", "Gemini Agent"),
                    "description": agent.get("description", ""),
                    "instruction": instruction,
                    "subagents": subagents,
                    "tool": tools,
                }
            )

        return normalized

    def fetch_components(self, bot_id):
        return {}

    def execute(self):
        print("Running Gemini Connector")
        self.validate_config()
        self.authenticate()

        bots = self.fetch_metadata()
        print(f"Found {len(bots)} bots")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {},
            template,
            "gemini",
        )

        init_pool()
        for agent in agent_cards:
            process_card(agent["data"])

        print("Gemini execution completed successfully")
