import json
import os
from pathlib import Path
from urllib.parse import quote

import requests

from .base_connector import BaseConnector
from utils.db import DATABASE_URL
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card


class SalesforceConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.instance_url = (config.get("instance_url") or "").rstrip("/")
        self.api_version = config.get("api_version")
        self.access_token = config.get("access_token")
        self.headers = {}

    def get_pg_dsn(self):
        return DATABASE_URL

    def validate_config(self):
        required = ["instance_url", "api_version", "access_token"]
        missing = [key for key in required if not self.config.get(key)]
        if missing:
            raise ValueError(
                "Missing salesforce config keys: " + ", ".join(missing)
            )

    def authenticate(self):
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def run_query(self, endpoint, soql):
        url = (
            f"{self.instance_url}/services/data/{self.api_version}/{endpoint}"
            f"?q={quote(soql)}"
        )
        response = requests.get(url, headers=self.headers, timeout=30)
        if response.status_code != 200:
            raise Exception(f"Query failed: {response.text}")
        return response.json().get("records", [])

    def fetch_metadata(self):
        print("Fetching Salesforce data...")

        bot_query = """
        SELECT
        Id,
        DeveloperName,
        Status,
        VersionNumber,
        BotDefinition.MasterLabel,
        BotDefinition.Description,
        BotDefinition.DeveloperName
        FROM BotVersion
        """

        plugin_query = """
        SELECT Id,MasterLabel,Description,Scope
        FROM GenAiPluginDefinition
        """

        function_query = """
        SELECT Id,MasterLabel,DeveloperName,Description,InvocationTargetType
        FROM GenAIFunctionDefinition
        """

        plugin_instruction_query = """
        SELECT Id,MasterLabel,Description,GenAiPluginDefinitionId
        FROM GenAiPluginInstructionDef
        """

        return {
            "bots": self.run_query("query", bot_query),
            "plugins": self.run_query("tooling/query", plugin_query),
            "functions": self.run_query("tooling/query", function_query),
            "instructions": self.run_query("tooling/query", plugin_instruction_query),
        }

    def normalize(self, data):
        bots = data["bots"]
        plugins = data["plugins"]
        functions = data["functions"]
        instructions = data["instructions"]

        plugin_map = {
            plugin["Id"]: {
                "identifier": plugin["Id"],
                "name": plugin.get("MasterLabel"),
                "description": plugin.get("Description"),
                "scope": plugin.get("Scope"),
                "parameter_type": "flow",
            }
            for plugin in plugins
        }

        function_map = {}
        for function in functions:
            function_map[function["Id"]] = {
                "identifier": function["Id"],
                "name": function.get("MasterLabel"),
                "developer_name": function.get("DeveloperName"),
                "description": function.get("Description"),
                "delegation_possible": None,
                "allowed_delegates": None,
                "parameter_name": None,
                "parameter_type": function.get("InvocationTargetType") or "flow",
                "default_value": None,
                "input_schema": None,
                "output_schema": None,
            }

        plugin_to_instructions = {}
        for instruction in instructions:
            plugin_id = instruction.get("GenAiPluginDefinitionId")
            if not plugin_id:
                continue

            plugin_to_instructions.setdefault(plugin_id, []).append(
                {
                    "identifier": instruction.get("Id"),
                    "name": instruction.get("MasterLabel", ""),
                    "description": None,
                    "trigger_condition": None,
                    "priority": None,
                    "instruction_text": instruction.get("Description"),
                    "model_parameters_override": {
                        "temperature": None,
                        "rationale": None,
                    },
                }
            )

        plugin_to_functions = {}
        for plugin_id, plugin in plugin_map.items():
            plugin_suffix = plugin_id[:15].lower()
            seen = set()

            for function in function_map.values():
                func_dev_name = (function.get("developer_name") or "").lower()
                func_type = function.get("parameter_type")

                if func_type == "standardInvocableAction":
                    continue

                if func_dev_name.endswith(plugin_suffix) and func_dev_name not in seen:
                    seen.add(func_dev_name)
                    plugin_to_functions.setdefault(plugin_id, []).append(function)

        output = []

        for bot in bots:
            bot_id = bot.get("Id")
            bot_def = bot.get("BotDefinition", {})
            bot_name = bot_def.get("MasterLabel")
            bot_desc = bot_def.get("Description")

            bot_dev_name = (
                bot_def.get("DeveloperName")
                or bot.get("DeveloperName")
                or ""
            )

            topics = []
            tools = []
            instruction_sets = []

            if bot_dev_name in ["Coral_Cloud_Agent", "Coral_Cloud_Experience_Agent"]:
                output.append(
                    {
                        "botid": bot_id,
                        "name": bot_name,
                        "description": bot_desc,
                        "instance_url": self.instance_url,
                    }
                )
                continue

            for plugin_id, plugin in plugin_map.items():
                plugin_name = (plugin.get("name") or "").lower().strip()
                bot_name_l = (bot_name or "").lower().strip()
                bot_desc_l = (bot_desc or "").lower().strip()
                bot_dev_l = (bot_dev_name or "").lower().strip()

                attach_plugin = False

                if plugin_name == "migrationdefaulttopic":
                    if bot_dev_name == "Copilot_for_Salesforce":
                        attach_plugin = True
                elif plugin_name == "experience management":
                    if (
                        "service" in bot_name_l
                        or "service" in bot_dev_l
                        or "experience" in bot_desc_l
                    ):
                        attach_plugin = True

                if not attach_plugin:
                    continue

                topics.append(
                    {
                        "identifier": plugin_id,
                        "name": plugin["name"],
                        "api_name": f"{plugin['name']}_{plugin_id}".replace(" ", "_"),
                        "description": plugin["description"],
                        "scope": plugin.get("scope"),
                    }
                )

                instruction_sets.extend(plugin_to_instructions.get(plugin_id, []))
                tools.extend(plugin_to_functions.get(plugin_id, []))

            bot_obj = {
                "botid": bot_id,
                "name": bot_name,
                "description": bot_desc,
                "instance_url": self.instance_url,
            }

            if topics:
                bot_obj["topics"] = topics
            if instruction_sets:
                bot_obj["instruction_sets"] = instruction_sets
            if tools:
                bot_obj["tool"] = tools

            output.append(bot_obj)

        return output

    def execute(self):
        print("Running Salesforce Connector")
        self.validate_config()
        self.authenticate()

        data = self.fetch_metadata()
        bots = self.normalize(data)
        print(f"Found {len(bots)} bots")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {},
            template,
            "salesforce",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "Salesforce"

        init_pool()
        for agent in agent_cards:
            process_card(agent["data"])

        print("Salesforce execution completed successfully")
