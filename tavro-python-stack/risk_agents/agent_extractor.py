import os
import re
import json
import uuid
import requests
import threading
import psycopg2
from pathlib import Path
from psycopg2.extras import RealDictCursor
from datetime import datetime
from rapidfuzz import process, fuzz
from typing import Dict, Any, List, Optional
from utils.set_environment import set_environment

set_environment('databases')
set_environment('postgres')
class AgentMetadataExporter:
    CORE_GLUE_DB_NAME=os.getenv("CORE_GLUE_DB_NAME")
    CURATED_GLUE_DB_NAME=os.getenv("CURATED_GLUE_DB_NAME")
    RISK_MANAGEMENT_DB_NAME=os.getenv("RISK_MANAGEMENT_DB_NAME", os.getenv("RISK_MANAGEMENT_GLUE_DB_NAME"))

    @staticmethod
    def _get_pg_config() -> Dict[str, Any]:
        return {
            "host": os.getenv("POSTGRES_HOST", os.getenv("PGHOST", "localhost")),
            "port": int(os.getenv("POSTGRES_PORT", os.getenv("PGPORT", "5432"))),
            "dbname": os.getenv("POSTGRES_DB", os.getenv("PGDATABASE", "postgres")),
            "user": os.getenv("POSTGRES_USER", os.getenv("PGUSER", "postgres")),
            "password": os.getenv("POSTGRES_PASSWORD", os.getenv("PGPASSWORD", "")),
        }

    @classmethod
    def _get_pg_connection(cls):
        try:
            return psycopg2.connect(**cls._get_pg_config())
        except psycopg2.OperationalError as e:
            raise ConnectionError(f"Failed to connect to PostgreSQL: {e}")

    @classmethod
    def execute_select(cls, query: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
        with cls._get_pg_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)
                return [dict(row) for row in cur.fetchall()]

    @classmethod
    def execute_dml(cls, query: str, params: Optional[tuple] = None) -> int:
        with cls._get_pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                affected = cur.rowcount
            conn.commit()
            return affected

    @classmethod
    def _get_agent_id_from_name(cls, agent_name: str, tenant_id: Optional[str] = None) -> Optional[str]:
        if not agent_name:
            return None

        clean_input = agent_name.strip()
        # Create a lowercase version for the SQL query
        lower_input = clean_input.lower()

        # ---------- 1. Normalize tenant ----------
        if not tenant_id or str(tenant_id).strip().lower() in ["none", "null", ""]:
            tenant_mode = "GLOBAL"
            tenant_id = None
        else:
            tenant_mode = "TENANT"
            tenant_id = cls.sanitize(str(tenant_id).strip())

        safe_input = cls.sanitize(lower_input)
        prefix = (
            cls.sanitize(lower_input[:4])
            if len(lower_input) >= 4
            else safe_input
        )

        # ---------- 2. Tenant WHERE ----------
        tenant_where = ""
        params = [f"%{safe_input}%", f"%{prefix}%"]

        if tenant_mode == "TENANT":
            tenant_where = """
            AND (
                tenant_id = %s
                OR tenant_id IS NULL
                OR tenant_id = ''
                OR tenant_id = 'None'
            )
            """
            params.append(tenant_id)

        # ---------- 3. Query ----------
        query = f"""
        SELECT agent_id, agent_name
        FROM {cls.CORE_GLUE_DB_NAME}.agents
        WHERE (
            lower(agent_name) LIKE %s
            OR lower(agent_name) LIKE %s
        )
        {tenant_where}
        LIMIT 200
        """

        rows = cls.execute_select(query, tuple(params))

        if not rows:
            return None

        candidates = []
        for row in rows:
            c_id = row.get("agent_id")
            c_name = row.get("agent_name")
            if c_id and c_name:
                candidates.append({
                    "id": c_id,
                    "name": c_name
                })

        if not candidates:
            return None

        # ---------- 4. Fuzzy matching ----------
        names_list = [c["name"] for c in candidates]

        result = process.extractOne(
            clean_input,
            names_list,
            scorer=fuzz.token_set_ratio
        )

        if result:
            matched_name, score, index = result

            print(
                f"Match Analysis: Input='{clean_input}' -> "
                f"Found='{matched_name}' (Score: {score:.2f})"
            )

            if score >= 80:
                return candidates[index]["id"]

        return None

    @staticmethod
    def _agent_card_dir() -> Path:
        return Path(os.getenv("LOCAL_AGENT_CARD_DIR", "./agent_cards"))

    @classmethod
    def _read_local_agent_card(cls, agent_name: Optional[str] = None, agent_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        card_dir = cls._agent_card_dir()
        if not card_dir.exists():
            return None
        files = sorted(card_dir.glob("*_agent_card.json"))
        if agent_id and agent_id.strip():
            target_id = agent_id.strip().lower()
            candidate = card_dir / f"{agent_id.strip()}_agent_card.json"
            if candidate.exists():
                with candidate.open("r", encoding="utf-8") as f:
                    return json.load(f)
            # Fallback: filename-insensitive and JSON-content match.
            for file_path in files:
                if file_path.name.lower() == f"{target_id}_agent_card.json":
                    with file_path.open("r", encoding="utf-8") as f:
                        return json.load(f)
                try:
                    with file_path.open("r", encoding="utf-8") as f:
                        card = json.load(f)
                    ident = card.get("identification") or {}
                    card_agent_id = str(ident.get("agent_id", "")).strip().lower()
                    card_internal_id = str(ident.get("agent_internal_id", "")).strip().lower()
                    if (card_agent_id and card_agent_id == target_id) or (
                        card_internal_id and card_internal_id == target_id
                    ):
                        return card
                except Exception:
                    continue
        if agent_name and agent_name.strip():
            target_name = agent_name.strip().lower()
            for file_path in files:
                try:
                    with file_path.open("r", encoding="utf-8") as f:
                        card = json.load(f)
                    card_name = str(card.get("name", "")).strip().lower()
                    if card_name and card_name == target_name:
                        return card
                except Exception:
                    continue
        return None

    @classmethod
    def get_agent_card(cls, agent_name: Optional[str] = None, agent_id: Optional[str] = None, tenant_id: Optional[str] = None) -> Dict[str, Any]:
        print(f"Fetching agent card for name='{agent_name}', id='{agent_id}'")

        if not agent_name and not agent_id:
            return {
                "error": "VALIDATION_ERROR",
                "details": "Either agent_name or agent_id must be provided"
            }

        try:

            # ---------- 1. Normalize tenant ----------
            if not tenant_id or str(tenant_id).strip().lower() in [
                "none",
                "null",
                ""
            ]:
                tenant_mode = "GLOBAL"
                tenant_id = None
            else:
                tenant_mode = "TENANT"
                tenant_id = cls.sanitize(str(tenant_id).strip())

            # ---------- 2. Resolve agent_id ----------
            if agent_name and not agent_id:
                agent_id = cls._get_agent_id_from_name(agent_name, tenant_id)
                print(f"Resolved agent_id='{agent_id}' from agent_name='{agent_name}'")
                if not agent_id:
                    return {
                        "error": "NOT_FOUND",
                        "details": f"No agent found with name '{agent_name}'"
                    }

            # ---------- 3. Validate agent_id ----------
            if not agent_id or not agent_id.strip():
                return {
                    "error": "VALIDATION_ERROR",
                    "details": "Resolved agent_id is invalid"
                }

            agent_id_clean = cls.sanitize(agent_id.strip())

            # ---------- 4. Build tenant filter ----------
            tenant_where = ""
            params = [agent_id_clean]

            if tenant_mode == "TENANT":
                tenant_where = """
                AND (
                    tenant_id = %s
                    OR tenant_id IS NULL
                    OR tenant_id = ''
                    OR tenant_id = 'None'
                )
                """
                params.append(tenant_id)

            # ---------- 5. Existence check ----------
            check_query = f"""
            SELECT 1
            FROM {cls.CORE_GLUE_DB_NAME}.agents
            WHERE agent_id = %s
            {tenant_where}
            LIMIT 1
            """

            check_rows = cls.execute_select(
                check_query,
                tuple(params)
            )

            if not check_rows:
                return {
                    "error": "NOT_FOUND",
                    "details": f"No agent found with id '{agent_id}'"
                }

            # ---------- 6. Read local card ----------
            local_card = cls._read_local_agent_card(
                agent_name=agent_name,
                agent_id=agent_id
            )

            if local_card:
                # Overlay mutable fields from the DB so edits are reflected immediately
                # without needing to regenerate the card file.
                try:
                    db_rows = cls.execute_select(
                        f"""
                        SELECT a.agent_name, a.agent_description,
                               i.instruction, i.governance_status, i.role
                        FROM {cls.CORE_GLUE_DB_NAME}.agents a
                        LEFT JOIN LATERAL (
                            SELECT instruction, governance_status, role
                            FROM {cls.CORE_GLUE_DB_NAME}.agent_identifications
                            WHERE agent_id = a.agent_id
                              AND COALESCE(is_current, true) = true
                            ORDER BY is_current DESC NULLS LAST,
                                     updated_ts DESC NULLS LAST
                            LIMIT 1
                        ) i ON true
                        WHERE a.agent_id = %s
                        LIMIT 1
                        """,
                        (agent_id_clean,),
                    )
                    if db_rows:
                        row = db_rows[0]
                        if row.get("agent_name"):
                            local_card["name"] = row["agent_name"]
                        if row.get("agent_description"):
                            local_card["description"] = row["agent_description"]
                        ident = local_card.get("identification") or {}
                        if row.get("instruction") is not None:
                            ident["instruction"] = row["instruction"]
                        if row.get("governance_status") is not None:
                            ident["governance_status"] = row["governance_status"]
                        if row.get("role") is not None:
                            ident["role"] = row["role"]
                        local_card["identification"] = ident
                except Exception as overlay_err:
                    print(f"[get_agent_card] DB overlay failed (returning card as-is): {overlay_err}")

                return local_card

            # ---------- 7. Not found ----------
            return {
                "error": "NOT_FOUND",
                "details": f"No agent card found for id '{agent_id}'."
            }

        except ValueError as ve:

            print(f"Validation error: {ve}")

            return {
                "error": "VALIDATION_ERROR",
                "details": str(ve)
            }

        except Exception as e:

            print(f"Unexpected error: {e}")

            return {
                "error": "INTERNAL_ERROR",
                "details": str(e)
            }

    @staticmethod
    def _resolve_record_window(start_record: int, max_records: int, record_range: str):
        """Resolve start and end record range."""
        if record_range:
            try:
                start, end = map(int, record_range.split("-"))
            except ValueError:
                raise ValueError("Invalid record_range format. Use 'start-end'.")
        else:
            start = start_record
            end = start_record + max_records - 1

        if start < 1 or end < start:
            raise ValueError("Invalid record window.")

        return start, end

    @classmethod
    def get_agent_catalog(
        cls,
        start_record: int = 1,
        max_records: int = 10,
        record_range: str = "1-10",
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:

        start, end = cls._resolve_record_window(
            start_record=start_record,
            max_records=max_records,
            record_range=record_range,
        )
        # ---------- 2. Normalize tenant ----------
        if not tenant_id or str(tenant_id).strip().lower() in ["none", "null", ""]:
            tenant_mode = "GLOBAL"
            tenant_id = None
        else:
            tenant_mode = "TENANT"
            tenant_id = cls.sanitize(str(tenant_id).strip())

        where_clause = ""
        if tenant_mode == "TENANT":
            where_clause = f"""
            WHERE (
                tenant_id = '{tenant_id}'
                OR tenant_id IS NULL
                OR tenant_id = ''
                OR tenant_id = 'None'
            )
            """
        query = f"""
            SELECT *
            FROM (
                SELECT 
                    *,
                    ROW_NUMBER() OVER () AS rn,
                    COUNT(*) OVER () AS total_records
                FROM {cls.CURATED_GLUE_DB_NAME}.agent_360
                {where_clause}
            ) AS catalog_page
            WHERE rn BETWEEN {start} AND {end}
        """

        rows: List[Dict[str, Any]] = []
        total_records = 0  # NEW

        result_rows = cls.execute_select(query)
        for row_dict in result_rows:
            if not total_records and row_dict.get("total_records") is not None:
                total_records = int(row_dict["total_records"])
            row_dict.pop("rn", None)
            row_dict.pop("total_records", None)
            rows.append(row_dict)

        return {
            "start_record": start,
            "end_record": end,
            "record_count": len(rows),
            "total_records": total_records,
            "data": rows,
        }
    
    @staticmethod
    def send_payload_async(payload: Dict[str, Any]) -> None:
        primary_url = os.getenv("RISK_CLASSIFY_URL", "http://tavro-api:8000/api/v1/risk/classify-risk")
        fallback_url = os.getenv("RISK_CLASSIFY_FALLBACK_URL", "http://localhost:8000/api/v1/risk/classify-risk")

        def _send():
            try:
                resp = requests.post(primary_url, json=payload, timeout=(2, 30))
                if resp.status_code >= 400:
                    print(f"[risk-trigger] Primary endpoint returned {resp.status_code}: {resp.text[:300]}")
            except Exception as e:
                print(f"[risk-trigger] Primary endpoint failed ({primary_url}): {e}")
                try:
                    resp = requests.post(fallback_url, json=payload, timeout=(2, 30))
                    if resp.status_code >= 400:
                        print(f"[risk-trigger] Fallback endpoint returned {resp.status_code}: {resp.text[:300]}")
                except Exception as ex:
                    print(f"[risk-trigger] Fallback endpoint failed ({fallback_url}): {ex}")

        threading.Thread(target=_send, daemon=True).start()

    @staticmethod
    def sanitize(val: str) -> str:
        return val.replace("'", "''") if val else val
    
    @staticmethod
    def _normalize_tenant_id(value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @staticmethod
    def _build_risk_payload(
        *,
        agent_internal_id: str,
        agent_id: str,
        agent_name: str,
        agent_description: str,
        agent_instructions: Optional[str],
        source_system: str,
        tenant_id: Optional[str]
    ) -> Dict[str, Any]:
        return {
            "agent_internal_id": agent_internal_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_description": agent_description,
            "agent_instructions": agent_instructions or "",
            "agent_role": "",
            "provider": source_system,
            "agent_platform": "",
            "attack_vector_av": "N",
            "attack_complexity_ac": "L",
            "attack_requirements_at": "P",
            "privileges_required_pr": "L",
            "user_interaction_ui": "P",
            "vulnerable_system_confidentiality_vc": "L",
            "vulnerable_system_integrity_vi": "L",
            "vulnerable_system_availability_va": "L",
            "subsequent_system_confidentiality_sc": "L",
            "subsequent_system_integrity_si": "L",
            "subsequent_system_availability_sa": "L",
            "tenant_id": tenant_id
        }

    @classmethod
    def create_risk_assessment_from_agent_id(
        cls,
        agent_id: str,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Trigger a risk assessment run for an existing agent by agent_id.

        Data is sourced from core tables:
          - core_database.agents (agent_internal_id, agent_name, agent_description)
          - core_database.agent_identifications (instruction)

        The tool reuses the existing /classify-risk pipeline by posting a payload
        (fire-and-forget) to the local service.
        """
        if not agent_id or not str(agent_id).strip():
            raise ValueError("agent_id is required.")

        agent_id_clean = cls.sanitize(str(agent_id).strip())

        where_clause = ""
        if tenant_id:
            where_clause = f"AND a.tenant_id = '{cls.sanitize(tenant_id)}'"

        query = f"""
            SELECT
                a.agent_internal_id,
                a.agent_id,
                a.agent_name,
                a.agent_description,
                a.source_system,
                i.instruction
            FROM {cls.CORE_GLUE_DB_NAME}.agents a
            LEFT JOIN {cls.CORE_GLUE_DB_NAME}.agent_identifications i
                ON a.agent_internal_id = i.agent_internal_id
                AND a.agent_id = i.agent_id
                AND i.is_current = true
                {where_clause}
            WHERE a.agent_id = '{agent_id_clean}'
              AND a.is_current = true
            ORDER BY a.updated_ts DESC
            LIMIT 1
        """

        rows = cls.execute_select(query)
        if not rows:
            return {"error": "NOT_FOUND", "details": f"No agent found with id '{agent_id}'"}

        row = rows[0]
        agent_internal_id = row.get("agent_internal_id") or ""
        agent_name = row.get("agent_name") or ""
        agent_description = row.get("agent_description") or ""
        agent_instructions = row.get("instruction") or ""
        source_system = row.get("source_system") or ""

        if not agent_internal_id.strip() or not agent_name.strip() or not agent_description.strip():
            return {
                "error": "INTERNAL_ERROR",
                "details": "Agent record is missing required fields (agent_internal_id/agent_name/agent_description).",
            }

        payload = cls._build_risk_payload(
            agent_internal_id=agent_internal_id,
            agent_id=str(agent_id).strip(),
            agent_name=agent_name,
            agent_description=agent_description,
            agent_instructions=agent_instructions,
            source_system=source_system,
            tenant_id=tenant_id,       
        )

        cls.send_payload_async(payload)

        return {
            "message": "Risk assessment triggered successfully.",
            "agent_id": str(agent_id).strip(),
            "agent_internal_id": agent_internal_id,
        }
    
    @classmethod
    def create_agent(
        cls,
        agent_name: str,
        description: str,
        instruction: str,
        tools: Optional[List[Dict[str, str]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        tenant_id: Optional[str] = None
    )-> Dict[str, Any]:
        if not agent_name or not description or not instruction:
            raise ValueError("agent_name, description, instruction are required")

        raw_agent_name = str(agent_name).strip()
        raw_description = str(description).strip()
        raw_instruction = str(instruction).strip()
        agent_name = cls.sanitize(raw_agent_name)
        description = cls.sanitize(raw_description)
        instruction = cls.sanitize(raw_instruction)
        tenant_id = cls.sanitize(str(tenant_id).strip()) if tenant_id else None

        agent_id = str(uuid.uuid4())
        agent_internal_id = str(uuid.uuid4())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        queries = []
        data_source_values = []

        # 1. agents table
        tenant_id_value = f"'{tenant_id}'," if tenant_id else ""
        tenant_id_column = "tenant_id," if tenant_id else ""
        queries.append(f"""
        INSERT INTO {cls.CORE_GLUE_DB_NAME}.agents (
            {tenant_id_column}
            agent_internal_id,
            agent_id,
            agent_name,
            agent_description,
            created_ts,
            updated_ts,
            is_current
        )
        VALUES (
             {tenant_id_value}
            '{agent_internal_id}',
            '{agent_id}',
            '{agent_name}',
            '{description}',
            TIMESTAMP '{now}',
            TIMESTAMP '{now}',
            true
        )
        """)

        # 2. agent_identifications
        queries.append(f"""
        INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_identifications (
            {tenant_id_column}
            agent_internal_id,
            agent_id,
            instruction,
            created_ts,
            updated_ts,
            is_current
        )
        VALUES (
             {tenant_id_value}
            '{agent_internal_id}',
            '{agent_id}',
            '{instruction}',
            TIMESTAMP '{now}',
            TIMESTAMP '{now}',
            true
        )
        """)

        # 3. tools (ONLY name + description)
        if tools:
            values_list = []
            for tool in tools:
                tool_id = str(uuid.uuid4())
                name = cls.sanitize(tool.get("name"))
                desc = cls.sanitize(tool.get("description"))

                values_list.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{tool_id}',
                    '{agent_id}',
                    '{name}',
                    '{desc}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                """)
                # --- agent_data_sources insert ---
                data_source_values.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{agent_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}',
                    '{agent_id}',
                    '{cls.sanitize(agent_name)}',
                    'Agent',
                    '{tool_id}',
                    '{name}',
                    'Tool'
                )
                """)

            tools_query = f"""
            INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_tools (
                {tenant_id_column}
                agent_internal_id,
                tool_id,
                agent_id,
                tool_name,
                tool_description,
                created_ts,
                updated_ts
            )
            VALUES
            {",".join(values_list)}
            """
            queries.append(tools_query)

        # 4. knowledge sources (ONLY name + description)
        if knowledge_source:
            ks_name = cls.sanitize(knowledge_source.get("name"))
            ks_desc = cls.sanitize(knowledge_source.get("description"))
            queries.append(f"""
            INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_knowledge_sources (
                {tenant_id_column}
                agent_internal_id,
                agent_id,
                name,
                description,
                created_ts,
                updated_ts
            )
            VALUES (
                {tenant_id_value}
                '{agent_internal_id}',
                '{agent_id}',
                '{ks_name}',
                '{ks_desc}',
                TIMESTAMP '{now}',
                TIMESTAMP '{now}'
            )
            """)
        
        # 5. data source insert (only if tools exist)
        if data_source_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_data_sources (
                {tenant_id_column}
                agent_internal_id,
                agent_id,
                created_ts,
                updated_ts,
                source_object_id,
                source_object_name,
                source_object_type,
                target_object_id,
                target_object_name,
                target_object_type
            )
            VALUES
            {",".join(data_source_values)}
            """)

        # 5. Execute
        for query in queries:
            cls.execute_dml(query)
        
        payload = {
            "agent_internal_id": agent_internal_id,
            "agent_id": agent_id,
            "agent_name": raw_agent_name,
            "agent_description": raw_description,
            "agent_instructions": raw_instruction,
            "agent_role": "",
            "provider": "MCP Server",
            "agent_platform": "",
            "tenant_id": tenant_id,
            "attack_vector_av": "N",
            "attack_complexity_ac": "L",
            "attack_requirements_at": "P",
            "privileges_required_pr": "L",
            "user_interaction_ui": "P",
            "vulnerable_system_confidentiality_vc": "L",
            "vulnerable_system_integrity_vi": "L",
            "vulnerable_system_availability_va": "L",
            "subsequent_system_confidentiality_sc": "L",
            "subsequent_system_integrity_si": "L",
            "subsequent_system_availability_sa": "L",
        }

        # Fire-and-forget
        cls.send_payload_async(payload)

        return {
            "agent_id": agent_id,
            "agent_name": raw_agent_name,
            "message": "Agent created successfully and risk assessment triggered."
        }
    
    @staticmethod
    def _normalize_use_case_priority(priority: str) -> str:
        raw = str(priority).strip().lower()
        if not raw:
            raise ValueError("priority is required.")

        value_to_label = {
            "1": "1 - Critical",
            "2": "2 - High",
            "3": "3 - Moderate",
            "4": "4 - Low",
            "5": "5 - Planning",
        }

        label_to_value = {
            "critical": "1",
            "high": "2",
            "moderate": "3",
            "low": "4",
            "planning": "5",
        }

        # Case 1: Input starts with number (e.g., "1", "01", "1 - Critical")
        number_match = re.match(r"^\s*0*([1-5])\b", raw)
        if number_match:
            return value_to_label[number_match.group(1)]

        # Case 2: Input is label (e.g., "critical")
        if raw in label_to_value:
            return value_to_label[label_to_value[raw]]

        raise ValueError(
            "Invalid priority. Allowed values: "
            "1 - Critical, 2 - High, 3 - Moderate, 4 - Low, 5 - Planning."
        )
    
    @classmethod
    def create_ai_use_case(
        cls,
        title: str,
        description: str,
        business_problem_statement: str,
        expected_benefits: str,
        priority: str,
        regulatory_impact: Optional[List[str]] = None,
        solution_approach: Optional[str] = None,
        use_case_owner: Optional[str] = None,
        impacted_business_applications: Optional[List[str]] = None,
        impacted_business_processes: Optional[List[str]] = None,
        tenant_id: Optional[str] = None
    ):
        if not title or not str(title).strip():
            raise ValueError("title is required.")
        if not description or not str(description).strip():
            raise ValueError("description is required.")
        if not business_problem_statement or not str(business_problem_statement).strip():
            raise ValueError("business_problem_statement is required.")
        if not expected_benefits or not str(expected_benefits).strip():
            raise ValueError("expected_benefits is required.")
        if not priority or not str(priority).strip():
            raise ValueError("priority is required.")
        if not use_case_owner or not str(use_case_owner).strip():
            use_case_owner = "System Administrator"
        else:
            use_case_owner = use_case_owner.strip()

        
        normalized_priority = cls._normalize_use_case_priority(priority)
        print(f"Normalized priority: '{normalized_priority}' from input '{priority}'")

        use_case_id = str(uuid.uuid4())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        def clean_list(items):
            if not items:
                return ""
            return ", ".join([str(item).strip() for item in items if str(item).strip()])

        regulatory_impact_str = clean_list(regulatory_impact)
        applications_str = clean_list(impacted_business_applications)
        processes_str = clean_list(impacted_business_processes)

        # Sanitize inputs (reuse your existing sanitizer if available)
        title = cls.sanitize(title)
        description = cls.sanitize(description)
        business_problem_statement = cls.sanitize(business_problem_statement)
        expected_benefits = cls.sanitize(expected_benefits)
        solution_approach = cls.sanitize(solution_approach or "")
        use_case_owner = cls.sanitize(use_case_owner or "")
        regulatory_impact_str = cls.sanitize(regulatory_impact_str)
        applications_str = cls.sanitize(applications_str)
        processes_str = cls.sanitize(processes_str)

        # ---------- 3. Build Query ----------
        tenant_id_clean = None
        if tenant_id and str(tenant_id).strip():
            tenant_id_clean = cls.sanitize(str(tenant_id).strip())
        query = f"""
        INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases (
            tenant_id,
            identifier,
            name,
            description,
            owner,
            problem_statement,
            expected_benefits,
            priority,
            status,
            solution_approach,
            created_ts,
            updated_ts,
            agent_internal_id
        )
        VALUES (
            '{tenant_id_clean}',
            '{use_case_id}',
            '{title}',
            '{description}',
            '{use_case_owner}',
            '{business_problem_statement}',
            '{expected_benefits}',
            '{normalized_priority}',
            'New',
            '{solution_approach}',
            TIMESTAMP '{now}',
            TIMESTAMP '{now}',
            NULL
        )
        """

        # ---------- 4. Execute ----------
        cls.execute_dml(query)

        # ---------- 5. Return Response ----------
        return {
            "message": "AI Use Case registered successfully.",
            "use_case_id": use_case_id,
        }
    
    @classmethod
    def get_ai_use_case(
        cls,
        use_case_id: Optional[str] = None,
        title: Optional[str] = None,
        start_record: int = 1,
        max_records: int = 10,
        record_range: str = "1-10",
        tenant_id: Optional[str] = None
    ):

        # ---------- 1. Pagination ----------
        start, end = cls._resolve_record_window(
            start_record=start_record,
            max_records=max_records,
            record_range=record_range,
        )

        # ---------- 2. Filters ----------
        where_clauses = []

        # ---------- 2. Normalize tenant ----------
        if not tenant_id or str(tenant_id).strip().lower() in ["none", "null", ""]:
            tenant_mode = "GLOBAL"
            tenant_id = None
        else:
            tenant_mode = "TENANT"
            tenant_id = cls.sanitize(str(tenant_id).strip())

        if use_case_id:
            use_case_id = cls.sanitize(use_case_id)
            where_clauses = []
            # Apply tenant filter only in TENANT mode
            if tenant_mode == "TENANT":
                where_clauses.append(f"""(
                    tenant_id = '{tenant_id}'
                    OR tenant_id IS NULL
                    OR tenant_id = ''
                    OR tenant_id = 'None'
                )""")
            where_clauses.append(f"identifier = '{use_case_id}'")
            start, end = 1, 1
        else:
            # ---------- 4. GLOBAL MODE ----------
            if tenant_mode == "GLOBAL":
                # No tenant filter → full access
                pass
            # ---------- 5. TENANT MODE ----------
            else:
                where_clauses.append(f"""(
                    tenant_id = '{tenant_id}'
                    OR tenant_id IS NULL
                    OR tenant_id = ''
                    OR tenant_id = 'None'
                )""")

        if title:
            title = cls.sanitize(title)
            where_clauses.append(f"LOWER(name) LIKE LOWER('%{title}%')")

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        # ---------- 3. Detail Query (single use-case with aggregated linked agents) ----------
        if use_case_id:
            detail_query = f"""
                SELECT
                    u.identifier,
                    u.name,
                    u.description,
                    u.owner,
                    u.problem_statement,
                    u.expected_benefits,
                    u.priority,
                    u.status,
                    u.solution_approach,
                    u.created_ts,
                    u.updated_ts,
                    u.agent_risk_exposure_are,
                    u.no_of_associated_agents,
                    u.inherent_risk_classification,
                    u.residual_risk_classification,
                    u.inherent_risk_classification_score,
                    u.residual_risk_classification_score,
                    u.agent_risk_tier_art,
                    COALESCE(
                        (
                            SELECT json_agg(
                                json_build_object(
                                    'agent_id', agent_rows.agent_id,
                                    'name', agent_rows.agent_name,
                                    'environment', agent_rows.environment
                                )
                                ORDER BY LOWER(COALESCE(agent_rows.agent_name, agent_rows.agent_id))
                            )
                            FROM (
                                SELECT DISTINCT
                                    rel.agent_id AS agent_id,
                                    ag.agent_name AS agent_name,
                                    ai.environment AS environment
                                FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases rel
                                LEFT JOIN {cls.CORE_GLUE_DB_NAME}.agents ag
                                    ON ag.agent_id = rel.agent_id
                                   AND ag.is_current = true
                                LEFT JOIN {cls.CORE_GLUE_DB_NAME}.agent_identifications ai
                                    ON ai.agent_internal_id = rel.agent_internal_id
                                   AND COALESCE(ai.is_current, true) = true
                                WHERE rel.identifier = u.identifier
                                  AND rel.agent_id IS NOT NULL
                                  AND rel.agent_id <> ''
                            ) agent_rows
                        ),
                        '[]'::json
                    ) AS of_associated_agents
                FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases u
                {where_sql}
                ORDER BY u.updated_ts DESC NULLS LAST, u.created_ts DESC
                LIMIT 1
            """

            detail_rows = cls.execute_select(detail_query)
            if not detail_rows:
                return {
                    "start_record": 1,
                    "end_record": 1,
                    "record_count": 0,
                    "total_records": 0,
                    "data": [],
                }

            row = detail_rows[0]
            return {
                "start_record": 1,
                "end_record": 1,
                "record_count": 1,
                "total_records": 1,
                "data": [{
                    "use_case_id": row.get("identifier"),
                    "title": row.get("name"),
                    "description": row.get("description"),
                    "owner": row.get("owner"),
                    "problem_statement": row.get("problem_statement"),
                    "expected_benefits": row.get("expected_benefits"),
                    "priority": row.get("priority"),
                    "status": row.get("status"),
                    "solution_approach": row.get("solution_approach"),
                    "created_ts": row.get("created_ts"),
                    "updated_ts": row.get("updated_ts"),
                    "agent_risk_exposure_are": row.get("agent_risk_exposure_are"),
                    "no_of_associated_agents": row.get("no_of_associated_agents"),
                    "inherent_risk_classification": row.get("inherent_risk_classification"),
                    "residual_risk_classification": row.get("residual_risk_classification"),
                    "inherent_risk_classification_score": row.get("inherent_risk_classification_score"),
                    "residual_risk_classification_score": row.get("residual_risk_classification_score"),
                    "agent_risk_tier_art": row.get("agent_risk_tier_art"),
                    "of_associated_agents": row.get("of_associated_agents") or [],
                }],
            }

        # ---------- 4. Catalog Query ----------
        query = f"""
            SELECT *
            FROM (
                SELECT 
                    identifier,
                    name,
                    description,
                    owner,
                    problem_statement,
                    expected_benefits,
                    priority,
                    status,
                    solution_approach,
                    created_ts,
                    ROW_NUMBER() OVER (ORDER BY created_ts DESC) AS rn,
                    COUNT(*) OVER () AS total_records
                FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
                {where_sql}
            ) AS use_case_page
            WHERE rn BETWEEN {start} AND {end}
        """

        # ---------- 5. Execute ----------
        result_rows = cls.execute_select(query)

        rows: List[Dict[str, Any]] = []
        total_records = 0

        for row_dict in result_rows:
            if not total_records and row_dict.get("total_records"):
                total_records = int(row_dict["total_records"])

            row_dict.pop("rn", None)
            row_dict.pop("total_records", None)

            rows.append({
                "use_case_id": row_dict.get("identifier"),
                "title": row_dict.get("name"),
                "description": row_dict.get("description"),
                "owner": row_dict.get("owner"),
                "problem_statement": row_dict.get("problem_statement"),
                "expected_benefits": row_dict.get("expected_benefits"),
                "priority": row_dict.get("priority"),
                "status": row_dict.get("status"),
                "solution_approach": row_dict.get("solution_approach"),
                "created_ts": row_dict.get("created_ts"),
            })

        # ---------- 6. Response ----------
        return {
            "start_record": start,
            "end_record": end,
            "record_count": len(rows),
            "total_records": total_records,
            "data": rows,
        }
    
    @staticmethod
    def _get_risk_tier(val: float) -> str:
        """Map blended risk score to risk tier."""
        if val < 3: return 'Low'
        if val < 7: return 'Medium'
        if val < 9: return 'High'
        return 'Critical'

    @staticmethod
    def _regulatory_risk_score(risk_classification: str) -> float:
        """Map EU AI Act risk classification to numeric score."""
        mapping = {"Prohibited": 10.0, "High Risk": 7.0}
        if not risk_classification:
            return 0.0
        return mapping.get(risk_classification, 1.0)
    
    @classmethod
    def create_ai_use_case_agent_relationship(
        cls,
        agent_catalog_id: int,
        ai_use_case_id: int,
        tenant_id: Optional[str] = None
    ):
        # 1. Validation & Sanitization
        if not agent_catalog_id or not ai_use_case_id:
            raise ValueError("Both IDs are required.")

        # Normalize tenant_id: treat "None", "null", "" as no-tenant (global mode)
        if not tenant_id or str(tenant_id).strip().lower() in ("none", "null", ""):
            tenant_id = None

        agent_catalog_id = cls.sanitize(str(agent_catalog_id).strip())
        ai_use_case_id = cls.sanitize(str(ai_use_case_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # 2. Check for existing relationship (Prevent duplicate rows)
        tenant_where = f"AND (tenant_id = '{cls.sanitize(tenant_id)}' OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')" if tenant_id else ""
        check_q = f"SELECT 1 FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases WHERE identifier = '{ai_use_case_id}' AND agent_id = '{agent_catalog_id}' {tenant_where} LIMIT 1"
        is_duplicate = len(cls.execute_select(check_q)) > 0

        # 3. Fetch Target Agent Details
        # Use COALESCE(is_current, true) so imported agents with NULL is_current are included.
        agent_q = f"""
            SELECT agent_id, agent_internal_id
            FROM {cls.CORE_GLUE_DB_NAME}.agents
            WHERE agent_id = '{agent_catalog_id}'
              AND COALESCE(is_current, true) = true
            LIMIT 1
        """
        agent_res = cls.execute_select(agent_q)
        # Fall back to curated.agent_360 for externally-imported agents not in core.agents
        if not agent_res:
            agent_res = cls.execute_select(
                f"SELECT agent_id, agent_internal_id FROM {cls.CURATED_GLUE_DB_NAME}.agent_360 WHERE agent_id = '{agent_catalog_id}' LIMIT 1"
            )
        if not agent_res:
            raise ValueError(f"Agent {agent_catalog_id} not found.")
        target_internal_id = agent_res[0].get("agent_internal_id")

        # 4. Metrics & Metadata: Calculate current family stats + the target agent
        metrics_q = f"""
            WITH current_agents AS (
                SELECT agent_internal_id FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases WHERE identifier = '{ai_use_case_id}'  {tenant_where}
                UNION
                SELECT '{target_internal_id}'
            ),
            risk_metrics AS (
                SELECT 
                    MAX(blended_risk_score) as max_score,
                    (SELECT agent_internal_id FROM {cls.CORE_GLUE_DB_NAME}.agent_risk_assessments
                     WHERE agent_internal_id IN (SELECT agent_internal_id FROM current_agents)
                     ORDER BY blended_risk_score DESC LIMIT 1) as worst_agent_id,
                    (SELECT COUNT(DISTINCT agent_internal_id) FROM current_agents) as total_agents
                FROM {cls.CORE_GLUE_DB_NAME}.agent_risk_assessments
                WHERE agent_internal_id IN (SELECT agent_internal_id FROM current_agents)
                AND is_current = true
            )
            SELECT m.*, uc.* FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases uc, risk_metrics m
            WHERE uc.identifier = '{ai_use_case_id}' {tenant_where} LIMIT 1
        """
        metrics_res = cls.execute_select(metrics_q)
        if not metrics_res:
            raise ValueError(f"AI Use Case {ai_use_case_id} not found.")
        
        data = metrics_res[0]
        worst_agent_id = data.get("worst_agent_id") or target_internal_id
        blended_score = float(data.get("max_score") or 0.0)
        total_associated = int(data.get("total_agents") or 1)

        # 5. Fetch Risk Details for the Worst Agent in the group
        risk_detail_q = f"""
            SELECT type_of_risk, risk_classification FROM {cls.RISK_MANAGEMENT_DB_NAME}.agent_risk_assessment
            WHERE agent_internal_id = '{worst_agent_id}' AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
            ORDER BY created_ts DESC
        """
        risk_rows = cls.execute_select(risk_detail_q)
        
        inherent_class = next((r['risk_classification'] for r in risk_rows if r['type_of_risk'] == 'Inherent Risk'), "")
        residual_class = next((r['risk_classification'] for r in risk_rows if r['type_of_risk'] == 'Residual Risk'), "")

        # 6. Calculations
        inherent_score = cls._regulatory_risk_score(inherent_class)
        residual_score = cls._regulatory_risk_score(residual_class)
        risk_tier = cls._get_risk_tier(blended_score)

        # 7. Step One: Physical Record Management
        if not is_duplicate:
            is_placeholder = not data.get("agent_id") or data.get("agent_id").strip() == ""
            if is_placeholder:
                action_q = f"UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases SET agent_id = '{agent_catalog_id}', agent_internal_id = '{target_internal_id}', updated_ts = TIMESTAMP '{now}' WHERE identifier = '{ai_use_case_id}'"
            else:
                action_q = f"""
                    INSERT INTO {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases (
                        agent_id, agent_internal_id, identifier, name, description, proposed_by, owner, 
                        function, problem_statement, expected_benefits, priority, status, 
                        created_ts, updated_ts, solution_approach
                        {', tenant_id' if tenant_id else ''}
                    ) VALUES (
                        '{agent_catalog_id}', '{target_internal_id}', '{ai_use_case_id}',
                        '{cls.sanitize(data.get("name"))}', '{cls.sanitize(data.get("description"))}',
                        '{cls.sanitize(data.get("proposed_by") or "")}', '{cls.sanitize(data.get("owner") or "")}',
                        '{cls.sanitize(data.get("function") or "")}', '{cls.sanitize(data.get("problem_statement") or "")}',
                        '{cls.sanitize(data.get("expected_benefits") or "")}', '{cls.sanitize(data.get("priority") or "")}',
                        '{cls.sanitize(data.get("status") or "ACTIVE")}', TIMESTAMP '{now}', TIMESTAMP '{now}',
                        '{cls.sanitize(data.get("solution_approach") or "")}'
                        {f", '{cls.sanitize(tenant_id)}'" if tenant_id else ''}
                    )
                """
            cls.execute_dml(action_q)

        # 8. Step Two: GLOBAL SYNC (Updates all siblings to match aggregate data)
        sync_q = f"""
            UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            SET agent_risk_exposure_are = {blended_score}, blended_risk_score = {blended_score},
                no_of_associated_agents = {total_associated}, inherent_risk_classification = '{inherent_class}',
                residual_risk_classification = '{residual_class}', inherent_risk_classification_score = {inherent_score},
                residual_risk_classification_score = {residual_score}, agent_risk_tier_art = '{risk_tier}',
                updated_ts = TIMESTAMP '{now}'
            WHERE identifier = '{ai_use_case_id}'{tenant_where}
        """
        cls.execute_dml(sync_q)

        return {"message": "Relationship synchronized", "associated_count": total_associated}

    @classmethod
    def remove_ai_use_case_agent_relationship(
        cls,
        agent_catalog_id: str,
        ai_use_case_id: str,
        tenant_id: Optional[str] = None
    ):
        if not agent_catalog_id or not ai_use_case_id:
            raise ValueError("Both IDs are required.")

        # Normalize tenant_id: treat "None", "null", "" as no-tenant (global mode)
        if not tenant_id or str(tenant_id).strip().lower() in ("none", "null", ""):
            tenant_id = None

        agent_catalog_id = cls.sanitize(str(agent_catalog_id).strip())
        ai_use_case_id = cls.sanitize(str(ai_use_case_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        tenant_where = f"AND (tenant_id = '{cls.sanitize(tenant_id)}' OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')" if tenant_id else ""

        rows_q = f"""
            SELECT *
            FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            WHERE identifier = '{ai_use_case_id}' {tenant_where}
        """
        all_rows = cls.execute_select(rows_q)
        if not all_rows:
            raise ValueError(f"AI Use Case {ai_use_case_id} not found.")

        matching_rows = [r for r in all_rows if (r.get("agent_id") or "").strip() == agent_catalog_id]
        if not matching_rows:
            return {"message": "Relationship not found", "associated_count": len([r for r in all_rows if (r.get("agent_id") or "").strip()])}

        linked_rows = [r for r in all_rows if (r.get("agent_id") or "").strip()]

        if len(linked_rows) == 1 and (linked_rows[0].get("agent_id") or "").strip() == agent_catalog_id:
            clear_q = f"""
                UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
                SET
                    agent_id = NULL,
                    agent_internal_id = NULL,
                    agent_risk_exposure_are = 0,
                    blended_risk_score = 0,
                    no_of_associated_agents = 0,
                    inherent_risk_classification = '',
                    residual_risk_classification = '',
                    inherent_risk_classification_score = 0,
                    residual_risk_classification_score = 0,
                    agent_risk_tier_art = 'Low',
                    updated_ts = TIMESTAMP '{now}'
                WHERE identifier = '{ai_use_case_id}'
                  AND agent_id = '{agent_catalog_id}'
                  {tenant_where}
            """
            cls.execute_dml(clear_q)
            return {"message": "Relationship removed", "associated_count": 0}

        delete_q = f"""
            DELETE FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            WHERE identifier = '{ai_use_case_id}'
              AND agent_id = '{agent_catalog_id}'
              {tenant_where}
        """
        cls.execute_dml(delete_q)

        remaining_agents_q = f"""
            SELECT DISTINCT agent_internal_id
            FROM {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            WHERE identifier = '{ai_use_case_id}'
              AND COALESCE(agent_internal_id, '') <> ''
              {tenant_where}
        """
        remaining_rows = cls.execute_select(remaining_agents_q)
        remaining_ids = [r.get("agent_internal_id") for r in remaining_rows if r.get("agent_internal_id")]
        associated_count = len(remaining_ids)

        if associated_count == 0:
            reset_q = f"""
                UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
                SET
                    agent_risk_exposure_are = 0,
                    blended_risk_score = 0,
                    no_of_associated_agents = 0,
                    inherent_risk_classification = '',
                    residual_risk_classification = '',
                    inherent_risk_classification_score = 0,
                    residual_risk_classification_score = 0,
                    agent_risk_tier_art = 'Low',
                    updated_ts = TIMESTAMP '{now}'
                WHERE identifier = '{ai_use_case_id}' {tenant_where}
            """
            cls.execute_dml(reset_q)
            return {"message": "Relationship removed", "associated_count": 0}

        ids_sql = ", ".join([f"'{cls.sanitize(str(x))}'" for x in remaining_ids])
        metrics_q = f"""
            WITH risk_metrics AS (
                SELECT
                    MAX(blended_risk_score) AS max_score,
                    (
                        SELECT agent_internal_id
                        FROM {cls.CORE_GLUE_DB_NAME}.agent_risk_assessments
                        WHERE agent_internal_id IN ({ids_sql})
                        ORDER BY blended_risk_score DESC
                        LIMIT 1
                    ) AS worst_agent_id
                FROM {cls.CORE_GLUE_DB_NAME}.agent_risk_assessments
                WHERE agent_internal_id IN ({ids_sql})
                  AND is_current = true
            )
            SELECT * FROM risk_metrics
        """
        metrics_res = cls.execute_select(metrics_q)
        metrics = metrics_res[0] if metrics_res else {}
        worst_agent_id = metrics.get("worst_agent_id")
        blended_score = float(metrics.get("max_score") or 0.0)

        inherent_class = ""
        residual_class = ""
        if worst_agent_id:
            risk_detail_q = f"""
                SELECT type_of_risk, risk_classification
                FROM {cls.RISK_MANAGEMENT_DB_NAME}.agent_risk_assessment
                WHERE agent_internal_id = '{cls.sanitize(str(worst_agent_id))}'
                  AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                ORDER BY created_ts DESC
            """
            risk_rows = cls.execute_select(risk_detail_q)
            inherent_class = next((r['risk_classification'] for r in risk_rows if r['type_of_risk'] == 'Inherent Risk'), "")
            residual_class = next((r['risk_classification'] for r in risk_rows if r['type_of_risk'] == 'Residual Risk'), "")

        inherent_score = cls._regulatory_risk_score(inherent_class)
        residual_score = cls._regulatory_risk_score(residual_class)
        risk_tier = cls._get_risk_tier(blended_score)

        sync_q = f"""
            UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            SET
                agent_risk_exposure_are = {blended_score},
                blended_risk_score = {blended_score},
                no_of_associated_agents = {associated_count},
                inherent_risk_classification = '{inherent_class}',
                residual_risk_classification = '{residual_class}',
                inherent_risk_classification_score = {inherent_score},
                residual_risk_classification_score = {residual_score},
                agent_risk_tier_art = '{risk_tier}',
                updated_ts = TIMESTAMP '{now}'
            WHERE identifier = '{ai_use_case_id}' {tenant_where}
        """
        cls.execute_dml(sync_q)

        return {"message": "Relationship removed", "associated_count": associated_count}

    @classmethod
    def update_agent(
        cls,
        agent_id: str,
        agent_name: Optional[str] = None,
        description: Optional[str] = None,
        instruction: Optional[str] = None,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if not agent_id or not str(agent_id).strip():
            raise ValueError("agent_id is required")

        agent_id = cls.sanitize(str(agent_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        agent_updates = [f"updated_ts = TIMESTAMP '{now}'"]
        if agent_name and str(agent_name).strip():
            agent_updates.append(f"agent_name = '{cls.sanitize(str(agent_name).strip())}'")
        if description and str(description).strip():
            agent_updates.append(f"agent_description = '{cls.sanitize(str(description).strip())}'")

        if len(agent_updates) > 1:
            cls.execute_dml(f"""
                UPDATE {cls.CORE_GLUE_DB_NAME}.agents
                SET {', '.join(agent_updates)}
                WHERE agent_id = '{agent_id}'
            """)

        if instruction and str(instruction).strip():
            cls.execute_dml(f"""
                UPDATE {cls.CORE_GLUE_DB_NAME}.agent_identifications
                SET instruction = '{cls.sanitize(str(instruction).strip())}',
                    updated_ts = TIMESTAMP '{now}'
                WHERE agent_id = '{agent_id}'
            """)

        return {"message": "Agent updated successfully.", "agent_id": agent_id}

    @classmethod
    def delete_agent(
        cls,
        agent_id: str,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if not agent_id or not str(agent_id).strip():
            raise ValueError("agent_id is required")

        agent_id = cls.sanitize(str(agent_id).strip())

        # Resolve the internal ID — needed for curated/risk tables
        rows = cls.execute_select(
            f"SELECT agent_internal_id FROM {cls.CORE_GLUE_DB_NAME}.agents WHERE agent_id = '{agent_id}' LIMIT 1"
        )
        if not rows:
            raise ValueError(f"Agent {agent_id} not found.")
        agent_internal_id = cls.sanitize(str(rows[0]["agent_internal_id"]))

        # 1. Clear agent references on linked use cases (don't delete the use case itself)
        cls.execute_dml(f"""
            UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            SET agent_id = NULL, agent_internal_id = NULL,
                no_of_associated_agents = GREATEST(COALESCE(no_of_associated_agents, 1) - 1, 0)
            WHERE agent_id = '{agent_id}'
        """)

        # 2. Core tables — all keyed on agent_id or agent_internal_id
        for table in ("agent_tools", "agent_knowledge_sources", "agent_data_sources", "agent_identifications"):
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_GLUE_DB_NAME}.{table} WHERE agent_id = '{agent_id}'"
            )

        cls.execute_dml(
            f"DELETE FROM {cls.CORE_GLUE_DB_NAME}.agent_risk_assessments WHERE agent_internal_id = '{agent_internal_id}'"
        )
        cls.execute_dml(
            f"DELETE FROM {cls.CORE_GLUE_DB_NAME}.agents WHERE agent_id = '{agent_id}'"
        )

        # 3. Curated snapshot
        if cls.CURATED_GLUE_DB_NAME:
            cls.execute_dml(
                f"DELETE FROM {cls.CURATED_GLUE_DB_NAME}.agent_360 WHERE agent_internal_id = '{agent_internal_id}'"
            )

        # 4. Risk management schema
        if cls.RISK_MANAGEMENT_DB_NAME:
            cls.execute_dml(
                f"DELETE FROM {cls.RISK_MANAGEMENT_DB_NAME}.agent_risk_assessment WHERE agent_internal_id = '{agent_internal_id}'"
            )

        return {"message": "Agent deleted successfully.", "agent_id": agent_id}

    @classmethod
    def update_ai_use_case(
        cls,
        use_case_id: str,
        title: Optional[str] = None,
        description: Optional[str] = None,
        business_problem_statement: Optional[str] = None,
        expected_benefits: Optional[str] = None,
        priority: Optional[str] = None,
        solution_approach: Optional[str] = None,
        use_case_owner: Optional[str] = None,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if not use_case_id or not str(use_case_id).strip():
            raise ValueError("use_case_id is required")

        use_case_id = cls.sanitize(str(use_case_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        updates = [f"updated_ts = TIMESTAMP '{now}'"]
        if title and str(title).strip():
            updates.append(f"name = '{cls.sanitize(str(title).strip())}'")
        if description and str(description).strip():
            updates.append(f"description = '{cls.sanitize(str(description).strip())}'")
        if business_problem_statement and str(business_problem_statement).strip():
            updates.append(f"problem_statement = '{cls.sanitize(str(business_problem_statement).strip())}'")
        if expected_benefits and str(expected_benefits).strip():
            updates.append(f"expected_benefits = '{cls.sanitize(str(expected_benefits).strip())}'")
        if priority and str(priority).strip():
            normalized = cls._normalize_use_case_priority(priority)
            updates.append(f"priority = '{cls.sanitize(normalized)}'")
        if solution_approach is not None:
            updates.append(f"solution_approach = '{cls.sanitize(str(solution_approach).strip())}'")
        if use_case_owner is not None and str(use_case_owner).strip():
            updates.append(f"owner = '{cls.sanitize(str(use_case_owner).strip())}'")

        cls.execute_dml(f"""
            UPDATE {cls.CORE_GLUE_DB_NAME}.agent_ai_use_cases
            SET {', '.join(updates)}
            WHERE identifier = '{use_case_id}'
        """)

        return {"message": "AI Use Case updated successfully.", "use_case_id": use_case_id}
