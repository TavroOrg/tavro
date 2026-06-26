"""
Agent365 Inbound Connector - imports Microsoft 365 agents into Tavro.

This follows the admin connector pattern: fetch source metadata, normalize to
Tavro bot dictionaries, transform through the agent-card template, and save
cards under extracted_json/agent365_inbound/.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from catalog_connector.connector.base_connector import BaseConnector
from catalog_connector.save import save_agent_cards
from catalog_connector.transformers.agent_transformer import transform_to_agent_cards

_TOKEN_URL = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
_DEVICE_SCOPE = "https://graph.microsoft.com/.default offline_access"
_PACKAGES_URL = "https://graph.microsoft.com/beta/copilot/admin/catalog/packages"
_ENV_FILE_PATH = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))


def _env_files() -> list[Path]:
    files = [_ENV_FILE_PATH]
    local_env = Path(".env")
    if local_env not in files:
        files.append(local_env)
    return files


def _read_env_value(*keys: str) -> str:
    values: dict[str, str] = {}
    for env_file in _env_files():
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            values[key.strip()] = value

    for key in keys:
        value = values.get(key) or os.getenv(key, "")
        if value:
            return value.strip()
    return ""


def _write_env_value(key: str, value: str) -> None:
    for env_file in _env_files():
        if not env_file.exists():
            continue
        lines = env_file.read_text(encoding="utf-8").splitlines()
        found = False
        for idx, line in enumerate(lines):
            if line.strip().startswith(f"{key}="):
                lines[idx] = f"{key}={value}"
                found = True
                break
        if not found:
            lines.append(f"{key}={value}")
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value


class Agent365InboundConnector(BaseConnector):
    def __init__(self, config: dict):
        self.config = config or {}
        self.access_token: Optional[str] = None

    def validate_config(self):
        missing = [
            key
            for key in ("tenant_id", "client_id", "client_secret")
            if not self.config.get(key) and not _read_env_value(f"AGENT365_{key.upper()}")
        ]
        if missing:
            raise ValueError("Missing Agent365 config keys: " + ", ".join(missing))

    def authenticate(self):
        tenant_id = self._tenant_id()
        client_id = self._client_id()
        refresh_token = self._refresh_token()
        if not refresh_token:
            raise ValueError("Missing AGENT365_REFRESH_TOKEN. Complete Microsoft sign-in first.")

        for tid in (tenant_id, "common"):
            resp = requests.post(
                _TOKEN_URL.format(tenant_id=tid),
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "refresh_token": refresh_token,
                    "scope": _DEVICE_SCOPE,
                },
                timeout=30,
            )
            print(f"[agent365] token refresh ({tid}) -> {resp.status_code}")
            if resp.status_code != 200:
                print(f"[agent365] token refresh error: {resp.text[:300]}")
                continue

            data = resp.json()
            new_refresh_token = data.get("refresh_token", "")
            if new_refresh_token and new_refresh_token != refresh_token:
                _write_env_value("AGENT365_REFRESH_TOKEN", new_refresh_token)
            self.access_token = data.get("access_token")
            return

        raise RuntimeError("Unable to refresh Microsoft delegated token")

    def _tenant_id(self) -> str:
        return (self.config.get("tenant_id") or _read_env_value("AGENT365_TENANT_ID")).strip()

    def _client_id(self) -> str:
        return (self.config.get("client_id") or _read_env_value("AGENT365_CLIENT_ID")).strip()

    def _refresh_token(self) -> str:
        return (self.config.get("refresh_token") or _read_env_value("AGENT365_REFRESH_TOKEN")).strip()

    def fetch_metadata(self) -> List[Dict]:
        if not self.access_token:
            raise RuntimeError("Agent365 connector is not authenticated")

        headers = {"Authorization": f"Bearer {self.access_token}"}
        packages: list[dict] = []
        url: Optional[str] = _PACKAGES_URL
        while url:
            resp = requests.get(url, headers=headers, timeout=60)
            print(f"[agent365] catalog packages -> {resp.status_code}")
            if resp.status_code != 200:
                raise RuntimeError(f"Graph catalog packages failed ({resp.status_code}): {resp.text[:300]}")
            data = resp.json()
            packages.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

        return [package for package in packages if self._is_agent_package(package)]

    def _is_agent_package(self, package: dict) -> bool:
        package_id = str(package.get("id") or "")
        if package_id.startswith("T_"):
            return True

        element_types = {str(item).lower() for item in (package.get("elementTypes") or [])}
        if element_types.intersection({
            "copilotagent",
            "declarativeagent",
            "declarativecopilots",
            "customcopilot",
            "agentskills",
            "agentconnectors",
        }):
            return True

        hosts = {str(item).lower() for item in (package.get("supportedHosts") or [])}
        return "copilot" in hosts or "microsoftcopilot" in hosts

    def normalize(self, records: List[Dict]) -> List[Dict]:
        bots: List[Dict] = []
        seen_ids: set[str] = set()
        for record in records:
            bot_id = str(record.get("id") or record.get("appId") or "").strip()
            if not bot_id or bot_id in seen_ids:
                continue
            seen_ids.add(bot_id)

            name = (
                record.get("displayName")
                or record.get("title")
                or record.get("name")
                or "Unnamed Agent"
            ).strip()
            description = (
                record.get("longDescription")
                or record.get("shortDescription")
                or record.get("description")
                or f"Microsoft 365 agent: {name}"
            ).strip()
            publisher = (
                record.get("publisherName")
                or record.get("developerName")
                or record.get("publisher")
                or (record.get("builderInfo") or {}).get("name")
                or "Microsoft 365"
            )

            instruction = self._build_instruction(record)
            bots.append({
                "botid": bot_id,
                "name": name,
                "description": description,
                "instruction": instruction,
                "provider_name": f"Microsoft 365 - {publisher}",
                "version": record.get("version") or "",
                "tool": self._extract_tools(record, name, description),
                "source_hash": hashlib.sha256(bot_id.encode()).hexdigest(),
            })
        return bots

    def _build_instruction(self, record: dict) -> str:
        lines: list[str] = []
        if record.get("instructions"):
            lines.append(str(record["instructions"]).strip())
        for label, key in (
            ("App Type", "appType"),
            ("Sensitivity", "sensitivity"),
            ("Version", "version"),
            ("Manifest ID", "manifestId"),
            ("Manifest Version", "manifestVersion"),
        ):
            value = record.get(key)
            if value:
                lines.append(f"{label}: {value}")
        if record.get("elementTypes"):
            lines.append("Element Types: " + ", ".join(str(item) for item in record["elementTypes"]))
        if record.get("supportedHosts"):
            lines.append("Supported Hosts: " + ", ".join(str(item) for item in record["supportedHosts"]))
        return "\n".join(lines)

    def _extract_tools(self, record: dict, name: str, description: str) -> list[dict]:
        tools: list[dict] = []

        def add_tool(tool_name: Any, tool_desc: Any = "") -> None:
            clean_name = str(tool_name or "").strip()
            if not clean_name:
                return
            if any(existing["name"].lower() == clean_name.lower() for existing in tools):
                return
            tools.append({"id": clean_name, "name": clean_name, "description": str(tool_desc or "").strip()})

        for field in ("customActions", "actions", "plugins", "tools"):
            for item in record.get(field, []) or []:
                if isinstance(item, dict):
                    add_tool(
                        item.get("name_for_human") or item.get("name") or item.get("displayName") or item.get("title") or item.get("id"),
                        item.get("description_for_human") or item.get("description") or item.get("summary"),
                    )

        if not tools and str(record.get("id") or "").startswith("T_"):
            add_tool(name, description[:300])
        return tools

    def execute(self):
        print("Running Agent365 Inbound Connector")
        self.validate_config()
        self.authenticate()

        records = self.fetch_metadata()
        bots = self.normalize(records)
        if not bots:
            print("No Agent365 agents found")
            return

        print(f"Found {len(bots)} Agent365 agent(s)")
        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with template_path.open("r", encoding="utf-8") as fh:
            template = json.load(fh)

        agent_cards = transform_to_agent_cards(
            bots,
            {"agent_id_map": {}},
            template,
            "agent365_inbound",
        )

        for card, bot in zip(agent_cards, bots):
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})["organization"] = bot.get("provider_name") or "Microsoft 365"
            card_data["version"] = bot.get("version") or ""
            if bot.get("tool"):
                card_data["tool"] = [
                    {
                        "identifier": tool.get("id") or tool.get("name"),
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": "Agent365",
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None,
                    }
                    for tool in bot["tool"]
                    if tool.get("name")
                ]

        save_agent_cards("agent365_inbound", agent_cards)
        print("Agent365 inbound execution completed successfully")
