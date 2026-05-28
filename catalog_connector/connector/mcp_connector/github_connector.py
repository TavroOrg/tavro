import hashlib
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

import psycopg2
import requests

from ..base_connector import BaseConnector
from utils.db import DATABASE_URL


class GithubConnector(BaseConnector):
    def __init__(self, config):
        self.config = config
        self.base_url = config.get("base_url")
        self.token = config.get("token")
        self.session = None

    def get_pg_dsn(self):
        return DATABASE_URL

    def validate_config(self):
        required = ["base_url", "token"]
        missing = [key for key in required if not self.config.get(key)]
        if missing:
            raise ValueError(
                "Missing GitHub MCP config values: " + ", ".join(missing)
            )

    def authenticate(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            }
        )

    def call_mcp(self, method):
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": {
                "clientInfo": {"name": "Python", "version": "1.0"}
            },
        }

        response = self.session.post(self.base_url, json=payload, timeout=45)
        if response.status_code != 200:
            raise Exception(
                f"GitHub MCP request failed ({response.status_code}): {response.text}"
            )
        return self.parse_response(response.text)

    @staticmethod
    def parse_response(body):
        if not body:
            raise Exception("Empty MCP response")

        data_lines = []
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("data:"):
                data_lines.append(stripped[len("data:"):].strip())

        if data_lines:
            return json.loads("".join(data_lines))

        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise Exception(f"Unable to parse MCP response: {exc}\n{body}")

    def _safe_mcp_fetch(self, method, extractor, default):
        try:
            payload = self.call_mcp(method)
            return extractor(payload)
        except Exception as exc:
            print(f"Warning: failed to fetch {method}: {exc}")
            return default

    @staticmethod
    def map_tool(tool):
        input_schema = tool.get("inputSchema") or tool.get("input_schema")
        if input_schema is None:
            input_schema = {
                "type": None,
                "properties": {
                    "input": {"type": None, "description": None}
                },
            }

        output_schema = tool.get("outputSchema") or tool.get("output_schema")
        if output_schema is None:
            output_schema = {
                "type": None,
                "properties": {
                    "output": {"type": None, "description": None}
                },
            }

        return {
            "identifier": tool.get("name"),
            "name": (
                tool.get("annotations", {}).get("title")
                or tool.get("title")
                or tool.get("name")
            ),
            "description": tool.get("description"),
            "delegation_possible": (
                tool.get("delegationPossible")
                or tool.get("delegation_possible")
            ),
            "allowed_delegates": (
                tool.get("allowedDelegates")
                or tool.get("allowed_delegates")
            ),
            "input_schema": input_schema,
            "output_schema": output_schema,
        }

    @staticmethod
    def map_resource(resource):
        return {
            "name": resource.get("name"),
            "description": resource.get("description"),
            "uri_template": resource.get("uriTemplate") or resource.get("uri_template"),
        }

    @staticmethod
    def map_prompt(prompt):
        return {
            "identifier": prompt.get("name"),
            "name": prompt.get("name"),
            "description": prompt.get("description"),
            "arguments": [
                {
                    "name": arg.get("name"),
                    "description": arg.get("description"),
                    "required": arg.get("required"),
                }
                for arg in prompt.get("arguments", [])
            ],
        }

    def fetch_metadata(self):
        initialize = self.call_mcp("initialize")

        metadata = {
            "source": "Github",
            "server": initialize.get("result") or initialize,
            "serverURL": self.base_url,
            "tools": [],
            "prompts": [],
            "resources": [],
            "resource_templates": [],
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }

        metadata["tools"] = self._safe_mcp_fetch(
            "tools/list",
            lambda payload: (
                (payload.get("result") or {}).get("tools")
                or payload.get("tools")
                or []
            ),
            [],
        )
        metadata["prompts"] = self._safe_mcp_fetch(
            "prompts/list",
            lambda payload: (
                (payload.get("result") or {}).get("prompts")
                or payload.get("prompts")
                or []
            ),
            [],
        )
        metadata["resources"] = self._safe_mcp_fetch(
            "resources/list",
            lambda payload: (
                (payload.get("result") or {}).get("resources")
                or payload.get("resources")
                or []
            ),
            [],
        )
        metadata["resource_templates"] = self._safe_mcp_fetch(
            "resources/templates/list",
            lambda payload: (
                (payload.get("result") or {}).get("resourceTemplates")
                or payload.get("resourceTemplates")
                or []
            ),
            [],
        )

        return metadata

    def normalize(self, metadata):
        template_path = Path(__file__).resolve().parents[2] / "mcp_server_card_template.json"
        with template_path.open("r", encoding="utf-8") as file:
            card = json.load(file)

        server = metadata.get("server", {})
        server_info = server.get("serverInfo") or server.get("server_info") or {}

        card["mcp_server"] = {
            "name": server_info.get("name"),
            "title": server_info.get("title"),
            "url": metadata.get("serverURL"),
            "version_number": server_info.get("version"),
            "protocol_version": (
                server.get("protocolVersion") or server.get("protocol_version")
            ),
        }
        card["tool"] = [self.map_tool(tool) for tool in metadata.get("tools", [])]
        card["resource"] = [
            self.map_resource(template)
            for template in metadata.get("resource_templates", [])
        ]
        card["prompt_template"] = [
            self.map_prompt(prompt)
            for prompt in metadata.get("prompts", [])
        ]
        return card

    @staticmethod
    def _to_text(value):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    @staticmethod
    def _format_kv_lines(values):
        if not isinstance(values, dict) or not values:
            return None
        items = [
            f"{key}:{value}"
            for key, value in values.items()
            if value is not None
        ]
        return "\n".join(items) if items else None

    def _extract_schema_description_map(self, schema):
        if not isinstance(schema, dict):
            return None

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return None

        mapped = {
            key: value.get("description")
            for key, value in properties.items()
            if isinstance(value, dict) and value.get("description")
        }
        return self._format_kv_lines(mapped)

    def _extract_arguments_map(self, arguments):
        if not isinstance(arguments, list):
            return None

        mapped = {
            arg.get("name"): arg.get("description")
            for arg in arguments
            if isinstance(arg, dict) and arg.get("name")
        }
        return self._format_kv_lines(mapped)

    @staticmethod
    def _hash_payload(card):
        canonical = json.dumps(
            card,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _fetch_existing_parent(self, cursor, name, url):
        cursor.execute(
            """
            SELECT identifier, source_hash, created_ts
            FROM core.agent_mcp_servers
            WHERE name = %s AND url = %s
            ORDER BY updated_ts DESC
            LIMIT 1
            """,
            (name, url),
        )
        return cursor.fetchone()

    def _upsert_parent(self, cursor, parent_id, card, source_hash, created_ts, now_ts):
        mcp_server = card.get("mcp_server", {})

        cursor.execute(
            """
            INSERT INTO core.agent_mcp_servers (
                tenant_id, agent_id, name, url, version_number, status,
                last_updated_ts, created_ts, updated_ts,
                agent_internal_id, identifier, source_hash
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (agent_internal_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                name = EXCLUDED.name,
                url = EXCLUDED.url,
                version_number = EXCLUDED.version_number,
                status = EXCLUDED.status,
                last_updated_ts = EXCLUDED.last_updated_ts,
                updated_ts = EXCLUDED.updated_ts,
                identifier = EXCLUDED.identifier,
                source_hash = EXCLUDED.source_hash
            """,
            (
                None,
                parent_id,
                mcp_server.get("name"),
                mcp_server.get("url"),
                mcp_server.get("version_number"),
                "active",
                now_ts,
                created_ts,
                now_ts,
                parent_id,
                parent_id,
                source_hash,
            ),
        )

    def _replace_child_rows(self, cursor, parent_id, card, now_ts):
        cursor.execute(
            "DELETE FROM core.agent_tools WHERE mcp_server_id = %s",
            (parent_id,),
        )
        cursor.execute(
            "DELETE FROM core.agent_prompt_templates WHERE mcp_server_id = %s",
            (parent_id,),
        )
        cursor.execute(
            "DELETE FROM core.agent_resources WHERE mcp_server_id = %s",
            (parent_id,),
        )

        tools = []
        seen_tools = set()
        for tool in card.get("tool", []):
            tool_id = tool.get("identifier")
            if not tool_id or tool_id in seen_tools:
                continue
            seen_tools.add(tool_id)

            delegation_possible = None
            if tool.get("delegation_possible") is not None:
                delegation_possible = str(tool.get("delegation_possible")).lower() == "true"

            tools.append(
                (
                    None,
                    tool_id,
                    parent_id,
                    tool.get("name"),
                    tool.get("description"),
                    delegation_possible,
                    self._to_text(tool.get("allowed_delegates")),
                    self._extract_schema_description_map(tool.get("input_schema")),
                    self._extract_schema_description_map(tool.get("output_schema")),
                    None,
                    now_ts,
                    now_ts,
                    parent_id,
                    parent_id,
                )
            )

        if tools:
            cursor.executemany(
                """
                INSERT INTO core.agent_tools (
                    tenant_id, tool_id, agent_id, tool_name, tool_description,
                    delegation_possible, allowed_delegates,
                    input_schema_json_text, output_schema_json_text, default_config_json_text,
                    created_ts, updated_ts, agent_internal_id, mcp_server_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                tools,
            )

        prompts = []
        for prompt in card.get("prompt_template", []):
            prompt_identifier = prompt.get("identifier")
            if not prompt_identifier:
                continue

            prompt_internal_id = f"{parent_id}:prompt:{prompt_identifier}"
            prompts.append(
                (
                    None,
                    parent_id,
                    prompt_identifier,
                    prompt.get("name"),
                    prompt.get("description"),
                    now_ts,
                    now_ts,
                    prompt_internal_id,
                    parent_id,
                    self._extract_arguments_map(prompt.get("arguments")),
                )
            )

        if prompts:
            cursor.executemany(
                """
                INSERT INTO core.agent_prompt_templates (
                    tenant_id, agent_id, identifier, name, description,
                    created_ts, updated_ts, agent_internal_id, mcp_server_id, arguments
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                prompts,
            )

        resources = []
        for resource in card.get("resource", []):
            resource_identifier = resource.get("name")
            if not resource_identifier:
                continue

            resources.append(
                (
                    None,
                    resource_identifier,
                    parent_id,
                    resource.get("name"),
                    resource.get("description"),
                    resource.get("uri_template"),
                    None,
                    None,
                    None,
                    None,
                    now_ts,
                    now_ts,
                )
            )

        if resources:
            cursor.executemany(
                """
                INSERT INTO core.agent_resources (
                    tenant_id, identifier, mcp_server_id, name, description, uri_template,
                    mime_type, type, tags, version, created_ts, updated_ts
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                resources,
            )

        return len(tools), len(prompts), len(resources)

    def upsert_to_postgres(self, card):
        mcp_server = card.get("mcp_server", {})
        server_name = mcp_server.get("name")
        server_url = mcp_server.get("url")

        if not server_name or not server_url:
            raise ValueError("mcp_server.name and mcp_server.url are required")

        source_hash = self._hash_payload(card)
        now_ts = datetime.utcnow()

        conn = psycopg2.connect(DATABASE_URL)
        try:
            with conn:
                with conn.cursor() as cursor:
                    existing = self._fetch_existing_parent(cursor, server_name, server_url)
                    parent_id = existing[0] if existing else str(uuid.uuid4())
                    existing_hash = existing[1] if existing else None
                    created_ts = existing[2] if existing and existing[2] else now_ts

                    if existing_hash == source_hash:
                        return {
                            "status": "SKIPPED",
                            "identifier": parent_id,
                            "source_hash": source_hash,
                            "tools": 0,
                            "prompts": 0,
                            "resources": 0,
                        }

                    self._upsert_parent(
                        cursor,
                        parent_id,
                        card,
                        source_hash,
                        created_ts,
                        now_ts,
                    )
                    tools_count, prompts_count, resources_count = self._replace_child_rows(
                        cursor,
                        parent_id,
                        card,
                        now_ts,
                    )

                    return {
                        "status": "PROCESSED",
                        "identifier": parent_id,
                        "source_hash": source_hash,
                        "tools": tools_count,
                        "prompts": prompts_count,
                        "resources": resources_count,
                    }
        finally:
            conn.close()

    def execute(self):
        print("Running GitHub MCP Connector")
        self.validate_config()
        self.authenticate()

        metadata = self.fetch_metadata()
        card = self.normalize(metadata)
        result = self.upsert_to_postgres(card)

        print(
            "GitHub MCP upsert complete "
            f"[status={result['status']}, tools={result['tools']}, "
            f"prompts={result['prompts']}, resources={result['resources']}]"
        )
