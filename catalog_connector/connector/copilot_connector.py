import requests
import os
import json
from .base_connector import BaseConnector
from utils.db import DATABASE_URL
from utils.auth import get_oauth2_token
from ..transformers.agent_transformer import transform_to_agent_cards
# from ..storage.s3_uploader import upload
from pathlib import Path
from worker import init_pool, process_card

class CopilotConnector(BaseConnector):

    def __init__(self, config):
        self.config = config
        self.token = None

    def get_pg_dsn(self):
        return DATABASE_URL

    def authenticate(self):
        self.token = get_oauth2_token(
            self.config["client_id"],
            self.config["client_secret"],
            self.config["tenant_id"],
            self.config["scope"]
        )

    def fetch_metadata(self):
        url = f"{self.config['org_url']}/api/data/v9.2/bots?$select=botid,name"

        headers = {
            'Authorization': f'Bearer {self.token}',
            'Accept': 'application/json'
        }

        response = requests.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(response.text)

        return response.json().get("value", [])

    def fetch_components(self, bot_id):
        url = f"{self.config['org_url']}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq '{bot_id}'"

        headers = {
            'Authorization': f'Bearer {self.token}',
            'Accept': 'application/json'
        }

        response = requests.get(url, headers=headers)

        if response.status_code != 200:
            return []

        return response.json().get("value", [])

    def validate_config(self):
        required_keys = [
            "client_id",
            "client_secret",
            "tenant_id",
            "scope",
            "org_url"
        ]

    # -------------------------------
    # EXECUTE PIPELINE
    # -------------------------------
    def execute(self):
        print("Running Copilot Connector")
        self.validate_config()

        # 1. Authenticate
        self.authenticate()

        # 2. Fetch bots
        bots = self.fetch_metadata()

        print(f"Found {len(bots)} bots")

        # 3. Fetch components
        components_map = {}

        for bot in bots:
            bot_id = bot.get("botid")

            try:
                components_map[bot_id] = self.fetch_components(bot_id)
            except Exception:
                components_map[bot_id] = []

        # 4. Load template
        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as f:
            template = json.load(f)


        # 5. Transform
        agent_cards = transform_to_agent_cards(
            bots,
            components_map,
            template,
            "copilot"
        )

        # 6. Directly insert transformed agent cards into DB

        init_pool()

        for agent in agent_cards:
            process_card(agent["data"])

        print("Copilot execution completed successfully")
