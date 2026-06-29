import requests
import os
import json
from .base_connector import BaseConnector
from utils.auth import get_oauth2_token
# from utils.config_loader import load_config
from ..transformers.agent_transformer import transform_to_agent_cards
# from ..storage.s3_uploader import upload
from pathlib import Path
# import psycopg2
# from worker import init_pool, process_card
import worker

class CopilotConnector(BaseConnector):

    def __init__(self, config):
        self.config = config
        # full_config = load_config()
        # self.postgres_config = full_config.get("postgres", {})
        self.token = None

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

    def authenticate(self):
        self.token = get_oauth2_token(
            self.config["client_id"],
            self.config["client_secret"],
            self.config["tenant_id"],
            self.config["scope"]
        )

    # def insert_into_db(self, agent_cards):
    #     postgres_config = self.get_postgres_config()
    #     conn = psycopg2.connect(
    #         host=postgres_config["POSTGRES_HOST"],
    #         database=postgres_config["POSTGRES_DB"],
    #         user=postgres_config["POSTGRES_USER"],
    #         password=postgres_config["POSTGRES_PASSWORD"],
    #         port=postgres_config["POSTGRES_PORT"]
    #     )
    #     cursor = conn.cursor()
    #     for agent in agent_cards:
    #         cursor.execute("""
    #             INSERT INTO core.agents (agent_id, agent_name, agent_description)
    #             VALUES (%s, %s, %s)
    #         """, (agent.get("agent_id"), agent.get("name"), agent.get("description")))
    #     conn.commit()
    #     cursor.close()
    #     conn.close()
    #     print("Inserted into DB successfully")

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

        # 6. Save to extracted_json/copilot/ instead of DB
        # if not os.getenv("PG_DSN"):
        #     os.environ["PG_DSN"] = self.get_pg_dsn()
        # init_pool()
        # for agent in agent_cards:
        #     process_card(agent["data"])
        for agent in agent_cards:
            worker.process_card(agent["data"])

        print("Copilot execution completed successfully")
