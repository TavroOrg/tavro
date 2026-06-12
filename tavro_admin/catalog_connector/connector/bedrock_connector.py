import json
import os
import re
from pathlib import Path

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from .base_connector import BaseConnector
# from utils.config_loader import load_config
from ..transformers.agent_transformer import transform_to_agent_cards
# from worker import init_pool, process_card
from save import save_agent_cards


class BedrockConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.region = config.get("region", "us-east-2")
        self.client = None

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
        required_keys = ["access_key", "secret_key"]
        missing_keys = [key for key in required_keys if not self.config.get(key)]
        if missing_keys:
            raise ValueError(
                "Missing bedrock config keys: " + ", ".join(missing_keys)
            )

    def authenticate(self):
        self.client = boto3.client(
            "bedrock-agent",
            region_name=self.region,
            aws_access_key_id=self.config["access_key"],
            aws_secret_access_key=self.config["secret_key"],
        )

    def fetch_guardrail(self, guardrail_id, guardrail_version):
        service = "bedrock"
        url = (
            f"https://bedrock.{self.region}.amazonaws.com/guardrails/"
            f"{guardrail_id}?guardrailVersion={guardrail_version}"
        )

        session = boto3.Session(
            aws_access_key_id=self.config["access_key"],
            aws_secret_access_key=self.config["secret_key"],
            region_name=self.region,
        )

        credentials = session.get_credentials()
        request = AWSRequest(method="GET", url=url)
        SigV4Auth(credentials, service, self.region).add_auth(request)

        response = requests.get(url, headers=dict(request.headers), timeout=30)
        if response.status_code != 200:
            print(f"Guardrail API failed for {guardrail_id}: {response.text}")
            return {}

        try:
            return response.json()
        except ValueError:
            return {}

    def _list_all(self, method_name, result_key, **kwargs):
        items = []
        next_token = None

        while True:
            call_args = dict(kwargs)
            if next_token:
                call_args["nextToken"] = next_token

            response = getattr(self.client, method_name)(**call_args)
            items.extend(response.get(result_key, []))

            next_token = response.get("nextToken")
            if not next_token:
                break

        return items

    def _normalize_text(self, text):
        return re.sub(r"[^a-z0-9]", "", (text or "").lower())

    def fetch_metadata(self):
        print("Fetching Bedrock data...")

        agent_summaries = self._list_all("list_agents", "agentSummaries")
        all_agents = {}

        for summary in agent_summaries:
            agent_id = summary.get("agentId")
            agent_name = summary.get("agentName")

            if not agent_id or not agent_name:
                continue

            response = self.client.get_agent(agentId=agent_id)
            metadata = response.get("agent", {})

            guardrail_config = metadata.get("guardrailConfiguration", {})
            guardrail_id = guardrail_config.get("guardrailIdentifier")
            guardrail_version = guardrail_config.get("guardrailVersion")

            if guardrail_version == "DRAFT":
                guardrail_version = "1"

            if guardrail_id and guardrail_version:
                try:
                    metadata["guardrailDetails"] = self.fetch_guardrail(
                        guardrail_id, guardrail_version
                    )
                except Exception as exc:
                    print(f"Guardrail fetch failed for {agent_name}: {exc}")
                    metadata["guardrailDetails"] = {}
            else:
                metadata["guardrailDetails"] = {}

            all_agents[agent_name] = metadata

        try:
            kb_summaries = self._list_all(
                "list_knowledge_bases", "knowledgeBaseSummaries"
            )
        except Exception as exc:
            print(f"Knowledge base listing failed: {exc}")
            kb_summaries = []

        all_kbs = {}
        for summary in kb_summaries:
            kb_id = summary.get("knowledgeBaseId")
            kb_name = summary.get("name")
            if not kb_id or not kb_name:
                continue

            try:
                kb_details = self.client.get_knowledge_base(knowledgeBaseId=kb_id)
                kb_details.pop("ResponseMetadata", None)
            except Exception:
                kb_details = {}

            all_kbs[kb_name] = {
                "id": kb_id,
                "metadata": kb_details,
            }

        for agent_name, metadata in all_agents.items():
            metadata["linkedKnowledgeBases"] = {}

            agent_id = metadata.get("agentId")
            agent_version = metadata.get("agentVersion") or "DRAFT"

            if agent_id:
                try:
                    kb_links = self._list_all(
                        "list_agent_knowledge_bases",
                        "agentKnowledgeBaseSummaries",
                        agentId=agent_id,
                        agentVersion=agent_version,
                    )

                    linked_ids = {
                        item.get("knowledgeBaseId")
                        for item in kb_links
                        if item.get("knowledgeBaseId")
                    }
                    for kb_name, kb in all_kbs.items():
                        if kb.get("id") in linked_ids:
                            metadata["linkedKnowledgeBases"][kb_name] = kb
                except Exception as exc:
                    print(f"Knowledge base mapping failed for {agent_name}: {exc}")

            instruction_norm = self._normalize_text(metadata.get("instruction", ""))
            for kb_name, kb in all_kbs.items():
                kb_norm = self._normalize_text(kb_name)
                if kb_norm and kb_norm[:8] in instruction_norm:
                    metadata["linkedKnowledgeBases"][kb_name] = kb

            if not metadata["linkedKnowledgeBases"] and len(all_kbs) == 1:
                only_kb_name = next(iter(all_kbs))
                metadata["linkedKnowledgeBases"][only_kb_name] = all_kbs[only_kb_name]

        for agent_name, metadata in all_agents.items():
            agent_id = metadata.get("agentId")
            if not agent_id:
                metadata["actionGroups"] = []
                continue

            try:
                versions = self._list_all(
                    "list_agent_versions", "agentVersionSummaries", agentId=agent_id
                )
            except Exception as exc:
                print(f"Version listing failed for {agent_name}: {exc}")
                versions = []

            final_version = None
            for version in versions:
                version_id = version.get("agentVersion")
                if version_id and version_id != "DRAFT":
                    final_version = version_id

            if not final_version and versions:
                final_version = versions[-1].get("agentVersion")

            metadata["agentVersion"] = final_version

            flat_action_groups = []
            for version in versions:
                version_id = version.get("agentVersion")
                if not version_id:
                    continue

                try:
                    action_groups = self._list_all(
                        "list_agent_action_groups",
                        "actionGroupSummaries",
                        agentId=agent_id,
                        agentVersion=version_id,
                    )
                except Exception as exc:
                    print(
                        f"Action group listing failed for {agent_name}"
                        f" version {version_id}: {exc}"
                    )
                    continue

                for group in action_groups:
                    group_id = group.get("actionGroupId")
                    if not group_id:
                        continue

                    try:
                        detail = self.client.get_agent_action_group(
                            agentId=agent_id,
                            agentVersion=version_id,
                            actionGroupId=group_id,
                        )
                        group_details = detail.get("agentActionGroup", {})
                    except Exception:
                        group_details = {}

                    flat_action_groups.append(
                        {
                            "actionGroupId": group_id,
                            "actionGroupName": group.get("actionGroupName"),
                            "details": group_details,
                        }
                    )

            metadata["actionGroups"] = flat_action_groups

        return all_agents

    def normalize(self, data):
        output = []

        for name, meta in data.items():
            bot_id = meta.get("agentId")
            description = meta.get("description")
            instruction = meta.get("instruction")

            knowledge_sources = []
            for kb_name, kb in meta.get("linkedKnowledgeBases", {}).items():
                knowledge_sources.append(
                    {
                        "identifier": kb.get("id"),
                        "name": kb_name,
                        "access_mechanism": "",
                    }
                )

            model_arn = meta.get("foundationModel", "")
            llm_model = []

            if model_arn:
                model_name = None
                version_number = None
                raw_model = model_arn.split("/")[-1]
                model_parts = raw_model.split(".")

                if len(model_parts) >= 3:
                    model_full = model_parts[2]
                    model_name = model_full.split("-v")[0]
                    match = re.search(r"-v([\d\.]+)", model_full)
                    if match:
                        version_number = match.group(1)

                if model_name:
                    llm_model.append(
                        {
                            "name": model_name,
                            "version_number": version_number,
                        }
                    )

            guardrail_details = meta.get("guardrailDetails", {})
            guardrail_name = guardrail_details.get("name")
            guardrail = None
            if guardrail_name:
                guardrail = {
                    "name": guardrail_name,
                    "description": guardrail_details.get("description"),
                    "model": None,
                }

            tools = []
            seen = set()
            for group in meta.get("actionGroups", []):
                group_id = group.get("actionGroupId") or group.get("actionGroupName")
                if not group_id or group_id in seen:
                    continue
                seen.add(group_id)

                details = group.get("details", {})
                tools.append(
                    {
                        "identifier": group_id,
                        "name": group.get("actionGroupName"),
                        "description": details.get("description"),
                        "delegation_possible": None,
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": None,
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None,
                    }
                )

            bot_obj = {
                "botid": bot_id,
                "name": name,
                "description": description,
                "instruction": instruction,
                "role": "",
                "governance_status": meta.get("agentStatus"),
                "version": meta.get("agentVersion"),
            }

            if knowledge_sources:
                primary_knowledge_source = knowledge_sources[0]
                bot_obj["knowledge_source"] = {
                    "id": primary_knowledge_source.get("identifier"),
                    "name": primary_knowledge_source.get("name"),
                }

            if tools:
                bot_obj["tool"] = tools

            if llm_model:
                bot_obj["llm_model"] = llm_model

            if guardrail:
                bot_obj["guardrail"] = guardrail

            output.append(bot_obj)

        return output

    def execute(self):
        print("Running Bedrock Connector")
        self.validate_config()

        self.authenticate()
        raw_data = self.fetch_metadata()
        bots = self.normalize(raw_data)

        print(f"Found {len(bots)} agents")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open(encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {},
            template,
            "bedrock",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "AWS Bedrock"

        # Save to extracted_json/bedrock/ instead of DB
        # if not os.getenv("PG_DSN"):
        #     os.environ["PG_DSN"] = self.get_pg_dsn()
        # init_pool()
        # for agent in agent_cards:
        #     process_card(agent["data"])
        save_agent_cards("bedrock", agent_cards)

        print("Bedrock execution completed successfully")
