import os
import re
import json
import uuid
import requests
import threading
from pathlib import Path
from datetime import datetime
from rapidfuzz import process, fuzz
from typing import Dict, Any, List, Optional
from contextlib import contextmanager
from utils.db import DATABASE_URL, SyncSessionLocal
from utils.set_environment import set_environment
from services.db.db_functions import refresh_curated_agent_360, create_local_agent_card

set_environment('databases')
COMPANY_API_BASE_URL = "http://tavro-api:8000/api/v1/companies"
class AgentMetadataExporter:
    CORE_DB_NAME=os.getenv("CORE_DB_NAME")
    CURATED_DB_NAME=os.getenv("CURATED_DB_NAME")
    RISK_MANAGEMENT_DB_NAME=os.getenv("RISK_MANAGEMENT_DB_NAME", os.getenv("RISK_MANAGEMENT_DB_NAME"))

    @classmethod
    @contextmanager
    def _get_db_cursor(cls):
        """Borrow a psycopg2 cursor from the SQLAlchemy sync session pool."""
        session = SyncSessionLocal()
        try:
            conn = session.connection()
            cursor = conn.connection.cursor()
            try:
                yield cursor
                conn.commit()
            finally:
                cursor.close()
        finally:
            session.close()

    @classmethod
    def execute_select(cls, query: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
        with cls._get_db_cursor() as cursor:
            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    @classmethod
    def execute_dml(cls, query: str, params: Optional[tuple] = None) -> int:
        with cls._get_db_cursor() as cursor:
            cursor.execute(query, params)
            return cursor.rowcount

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
        FROM {cls.CORE_DB_NAME}.agents
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
            FROM {cls.CORE_DB_NAME}.agents
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
                        FROM {cls.CORE_DB_NAME}.agents a
                        LEFT JOIN LATERAL (
                            SELECT instruction, governance_status, role
                            FROM {cls.CORE_DB_NAME}.agent_identifications
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

                # Overlay linked AI use cases for this specific agent_id.
                try:
                    use_case_rows = cls.execute_select(
                        f"""
                        SELECT DISTINCT ON (u.ai_use_case_id)
                            u.ai_use_case_id AS identifier,
                            COALESCE(uc.name, u.ai_use_case_name) AS name,
                            uc.description,
                            uc.proposed_by,
                            uc.owner,
                            uc.function,
                            uc.problem_statement,
                            uc.expected_benefits,
                            uc.priority,
                            uc.status,
                            COALESCE(uc.updated_ts, u.updated_ts) AS updated_ts,
                            COALESCE(uc.created_ts, u.created_ts) AS created_ts
                        FROM {cls.CORE_DB_NAME}.agent_ai_use_cases u
                        LEFT JOIN {cls.CORE_DB_NAME}.ai_use_cases uc
                          ON uc.ai_use_case_id = u.ai_use_case_id
                         AND COALESCE(uc.tenant_id, '') = COALESCE(u.tenant_id, '')
                        WHERE u.agent_id = %s
                        ORDER BY u.ai_use_case_id, uc.updated_ts DESC NULLS LAST, uc.created_ts DESC NULLS LAST, u.updated_ts DESC NULLS LAST
                        """,
                        (agent_id_clean,),
                    )
                    ai_use_cases = [
                        {
                            "identifier": r.get("identifier"),
                            "name": r.get("name"),
                            "description": r.get("description"),
                            "proposed_by": r.get("proposed_by"),
                            "owner": r.get("owner"),
                            "function": r.get("function"),
                            "problem_statement": r.get("problem_statement"),
                            "expected_benefits": r.get("expected_benefits"),
                            "priority": r.get("priority"),
                            "status": r.get("status"),
                        }
                        for r in use_case_rows
                        if r.get("identifier")
                    ]
                    local_card["ai_use_cases"] = ai_use_cases
                    if ai_use_cases:
                        # Keep backward compatibility for UIs that still read singular ai_use_case.
                        local_card["ai_use_case"] = ai_use_cases[0]
                except Exception as use_case_overlay_err:
                    print(f"[get_agent_card] AI use case overlay failed: {use_case_overlay_err}")

                # Overlay linked skills from DB so lineage/config views reflect
                # skills loaded after the local card was first written.
                try:
                    skill_params: list[Any] = [agent_id_clean]
                    skill_tenant_where = ""
                    if tenant_mode == "TENANT":
                        skill_tenant_where = """
                        AND (
                            rel.tenant_id = %s
                            OR rel.tenant_id IS NULL
                            OR rel.tenant_id = ''
                            OR rel.tenant_id = 'None'
                        )
                        """
                        skill_params.append(tenant_id)

                    skill_rows = cls.execute_select(
                        f"""
                        SELECT DISTINCT ON (LOWER(TRIM(rel.skill_id)))
                            rel.skill_id AS identifier,
                            COALESCE(s.name, rel.skill_name, rel.skill_id) AS name,
                            s.description,
                            s.tags,
                            s.input_modes,
                            s.output_modes
                        FROM {cls.CORE_DB_NAME}.agent_skills rel
                        LEFT JOIN {cls.CORE_DB_NAME}.skills s
                          ON LOWER(TRIM(s.skill_id)) = LOWER(TRIM(rel.skill_id))
                         AND COALESCE(s.tenant_id, '') = COALESCE(rel.tenant_id, '')
                        WHERE rel.agent_id = %s
                          {skill_tenant_where}
                          AND rel.skill_id IS NOT NULL
                          AND rel.skill_id <> ''
                        ORDER BY LOWER(TRIM(rel.skill_id))
                        """,
                        tuple(skill_params),
                    )
                    db_skills = [
                        {
                            "identifier": r.get("identifier"),
                            "name": r.get("name"),
                            "description": r.get("description"),
                            "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
                            "inputModes": r.get("input_modes") if isinstance(r.get("input_modes"), list) else [],
                            "outputModes": r.get("output_modes") if isinstance(r.get("output_modes"), list) else [],
                        }
                        for r in skill_rows
                        if r.get("identifier")
                    ]
                    if db_skills:
                        local_card["skills"] = db_skills
                except Exception as skill_overlay_err:
                    print(f"[get_agent_card] Skills overlay failed: {skill_overlay_err}")

                # Overlay latest risk assessment directly from DB so the card
                # always reflects the most recent completed assessment, regardless
                # of when the local JSON file was last regenerated.
                try:
                    ra_rows = cls.execute_select(
                        f"""
                        SELECT risk_assessment_id, assessment_name, assessor_name,
                               assessment_ts, blended_risk_score, blended_risk_class,
                               aivss_score, aivss_class, regulatory_risk_score,
                               regulatory_risk_class, state_name, summary
                        FROM {cls.CORE_DB_NAME}.agent_risk_assessments
                        WHERE agent_id = %s
                        ORDER BY updated_ts DESC NULLS LAST, created_ts DESC NULLS LAST
                        LIMIT 1
                        """,
                        (agent_id_clean,),
                    )
                    if ra_rows:
                        ra = ra_rows[0]
                        local_card["risk_assessment"] = {
                            "identifier": ra.get("risk_assessment_id"),
                            "name": ra.get("assessment_name"),
                            "assessor": ra.get("assessor_name"),
                            "date": str(ra.get("assessment_ts")) if ra.get("assessment_ts") else None,
                            "blended_risk_score": ra.get("blended_risk_score"),
                            "blended_risk_class": ra.get("blended_risk_class"),
                            "aivss_score": ra.get("aivss_score"),
                            "aivss_classification": ra.get("aivss_class"),
                            "regulatory_risk_score": ra.get("regulatory_risk_score"),
                            "regulatory_risk_classification": ra.get("regulatory_risk_class"),
                            "state": ra.get("state_name"),
                            "summary": ra.get("summary"),
                        }
                except Exception as ra_overlay_err:
                    print(f"[get_agent_card] Risk assessment overlay failed (returning card as-is): {ra_overlay_err}")

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
                FROM {cls.CURATED_DB_NAME}.agent_360
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
    def _to_bool_ds(val) -> str:
        """Convert a pii/phi/pci value to a SQL boolean literal."""
        if val is None:
            return "NULL"
        if isinstance(val, bool):
            return "TRUE" if val else "FALSE"
        return "TRUE" if str(val).strip().lower() in ("yes", "true", "1") else "FALSE"

    @classmethod
    def _build_data_source_entries(
        cls,
        agent_id: str,
        agent_name: str,
        data_sources: List[Dict],
    ) -> List[Dict]:
        """
        Convert a user-provided list of table/column definitions into flat
        data-source relationship entries covering Agent→Table and Table→Column.

        Each entry in data_sources must have at minimum a ``table_name``.
        Optional per-table fields: ``table_domain``, ``access_level``.
        Optional per-column fields: ``column_domain``.

        ``table_id`` and ``column_id`` are always auto-generated (UUID4).
        ``uses_pii``, ``uses_phi``, ``uses_pci`` are always stored as NULL.
        """
        entries: List[Dict] = []
        for ds in data_sources:
            table_name = str(ds.get("table_name") or "").strip()
            if not table_name:
                continue
            table_id = str(uuid.uuid4())
            table_domain = ds.get("table_domain") or None

            # Agent → Table
            entries.append({
                "relationship_id":        None,
                "parent_relationship_id": None,
                "source_object_id":       agent_id,
                "source_object_domain":   None,
                "source_object_name":     agent_name,
                "source_object_type":     "Agent",
                "target_object_id":       table_id,
                "target_object_domain":   table_domain,
                "target_object_name":     table_name,
                "target_object_type":     "Table",
                "access_level":           ds.get("access_level"),
                "uses_pii":               None,
                "uses_phi":               None,
                "uses_pci":               None,
            })

            # Table → Column
            for col in (ds.get("columns") or []):
                column_name = str(col.get("column_name") or "").strip()
                if not column_name:
                    continue
                entries.append({
                    "relationship_id":        None,
                    "parent_relationship_id": None,
                    "source_object_id":       table_id,
                    "source_object_domain":   table_domain,
                    "source_object_name":     table_name,
                    "source_object_type":     "Table",
                    "target_object_id":       str(uuid.uuid4()),
                    "target_object_domain":   col.get("column_domain") or None,
                    "target_object_name":     column_name,
                    "target_object_type":     "Column",
                    "access_level":           None,
                    "uses_pii":               None,
                    "uses_phi":               None,
                    "uses_pci":               None,
                })
        return entries

    @classmethod
    def _build_ds_sql_values(
        cls,
        entries: List[Dict],
        agent_internal_id: str,
        agent_id: str,
        now: str,
        tenant_id_column: str,
        tenant_id_value: str,
    ) -> List[str]:
        """Convert data-source entry dicts to SQL VALUES tuples.

        The column order must match the INSERT statement in callers:
            {tenant_id_column} agent_internal_id, agent_id,
            access_level, contains_pii, contains_phi, contains_pci,
            created_ts, updated_ts,
            source_object_id, source_object_domain, source_object_name, source_object_type,
            target_object_id, target_object_domain, target_object_name, target_object_type
        """
        def _sq(v) -> str:
            if v is None:
                return "NULL"
            return "'" + str(v).replace("'", "''") + "'"

        values = []
        for e in entries:
            values.append(
                f"({tenant_id_value}"
                f"{_sq(agent_internal_id)},{_sq(agent_id)},"
                f"{_sq(e.get('access_level'))},"
                f"{cls._to_bool_ds(e.get('uses_pii'))}::boolean,"
                f"{cls._to_bool_ds(e.get('uses_phi'))}::boolean,"
                f"{cls._to_bool_ds(e.get('uses_pci'))}::boolean,"
                f"TIMESTAMP '{now}',TIMESTAMP '{now}',"
                f"{_sq(e.get('source_object_id'))},{_sq(e.get('source_object_domain'))},"
                f"{_sq(e.get('source_object_name'))},{_sq(e.get('source_object_type'))},"
                f"{_sq(e.get('target_object_id'))},{_sq(e.get('target_object_domain'))},"
                f"{_sq(e.get('target_object_name'))},{_sq(e.get('target_object_type'))})"
            )
        return values

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
            FROM {cls.CORE_DB_NAME}.agents a
            LEFT JOIN {cls.CORE_DB_NAME}.agent_identifications i
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
    def _write_agent_card(
        cls,
        agent_id: str,
        agent_internal_id: str,
        agent_name: str,
        description: str,
        instruction: str,
        tools: Optional[List[Dict[str, str]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        tool_ids: Optional[List[str]] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
        data_sources: Optional[List[Dict]] = None,
    ) -> None:
        """Write a full agent card JSON file immediately after creation so get_agent_card returns complete details."""
        try:
            card_dir = cls._agent_card_dir()
            card_dir.mkdir(parents=True, exist_ok=True)

            tool_entries = []
            data_source_entries = []
            if tools and tool_ids:
                for tool, tool_id in zip(tools, tool_ids):
                    tool_entries.append({
                        "identifier": tool_id,
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "delegation_possible": None,
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": None,
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None,
                    })
                    # Agent → Tool data-source entry
                    data_source_entries.append({
                        "relationship_id":        None,
                        "parent_relationship_id": None,
                        "source_object_id":       agent_id,
                        "source_object_domain":   None,
                        "source_object_name":     agent_name,
                        "source_object_type":     "Agent",
                        "target_object_id":       tool_id,
                        "target_object_domain":   None,
                        "target_object_name":     tool.get("name"),
                        "target_object_type":     "Tool",
                        "access_level":           None,
                        "uses_pii":               None,
                        "uses_phi":               None,
                        "uses_pci":               None,
                    })

            # Agent → Table → Column entries (appended alongside tool entries)
            if data_sources:
                data_source_entries += cls._build_data_source_entries(agent_id, agent_name, data_sources)

            ks_entry = None
            if knowledge_source:
                ks_entry = {
                    "identifier": None,
                    "name": knowledge_source.get("name"),
                    "access_mechanism": None,
                }

            skill_entries = []
            for s in (skills or []):
                if isinstance(s, str):
                    skill_entries.append({"identifier": s, "name": s, "description": None, "tags": [], "inputModes": [], "outputModes": []})
                elif isinstance(s, dict):
                    skill_id = s.get("identifier") or s.get("skill_id") or s.get("id") or s.get("name") or ""
                    skill_entries.append({
                        "identifier": skill_id,
                        "name": s.get("name") or s.get("skill_name") or skill_id,
                        "description": s.get("description"),
                        "tags": s.get("tags") if isinstance(s.get("tags"), list) else [],
                        "inputModes": s.get("inputModes") or s.get("input_modes") or [],
                        "outputModes": s.get("outputModes") or s.get("output_modes") or [],
                    })

            card = {
                "capabilities": {"streaming": False},
                "defaultInputModes": ["text"],
                "defaultOutputModes": ["text"],
                "name": agent_name,
                "description": description,
                "preferredTransport": None,
                "protocol_version": None,
                "instruction_sets": [],
                "skills": skill_entries,
                "provider": {"organization": None, "url": ""},
                "url": "",
                "documentation_url": None,
                "icon_url": None,
                "security": None,
                "security_schemes": None,
                "signatures": None,
                "supports_authenticated_extended_card": None,
                "additional_interfaces": None,
                "version": "1.0",
                "identification": {
                    "agent_id": agent_id,
                    "agent_internal_id": agent_internal_id,
                    "goal_orientation": None,
                    "role": None,
                    "instruction": instruction,
                    "owner": None,
                    "environment": None,
                    "tags": None,
                    "governance_status": "Risk Assessment is running",
                    "reviewer": None,
                    "cost_center": None,
                },
                "configuration": {
                    "access_scope": None,
                    "memory_type": None,
                    "data_freshness_policy": None,
                    "autonomy_level": None,
                    "reasoning_model": None,
                },
                "ai_use_case": [{"identifier": None, "name": None, "description": None, "proposed_by": None, "owner": None, "business_function": None, "problem_statement": None, "expected_benefits": None, "priority": None, "status": None}],
                "application": [{"identifier": None, "name": None, "description": None, "business_criticality": None, "emergency_tier": None}],
                "ai_model": [{"name": None, "owner": None, "department_executive": None, "description": None}],
                "business_process": [{"identifier": None, "name": None, "description": None, "business_criticality": None}],
                "physical_ai": [{"identifier": None, "name": None, "type": None, "sensory_input_source": None}],
                "llm_model": [{"name": None, "version_number": None}],
                "guardrail": {"name": None, "description": None, "model": None},
                "mcp_server": {"name": None, "url": None, "version_number": None},
                "tool": tool_entries,
                "data_source": data_source_entries,
                "knowledge_source": ks_entry,
                "prompt_template": {"identifier": None, "name": None, "description": None},
                "memory": {"identifier": None, "name": None, "type": None},
                "regulation_or_framework": {"name": None, "type": None, "regulatory_authority": None, "jurisdiction": None, "requirement": None},
                "control": [{"identifier": None, "name": None, "objective": None, "domain": None}],
                "risk_assessment": None,
            }

            card_path = card_dir / f"{agent_id}_agent_card.json"
            with card_path.open("w", encoding="utf-8") as f:
                json.dump(card, f, indent=2, ensure_ascii=False)
            print(f"[create_agent] Agent card written: {card_path}")

        except Exception as e:
            print(f"[create_agent] Warning: failed to write agent card file: {e}")

    @classmethod
    def create_agent(
        cls,
        agent_name: str,
        description: str,
        instruction: str,
        tools: Optional[List[Dict[str, str]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
        tenant_id: Optional[str] = None,
        data_sources: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new agent.

        ``data_sources`` accepts a list of table/column definitions that describe
        the Agent → Table → Column data-source hierarchy.  Each entry supports:

            {
              "table_name":   str,            # required
              "table_domain": str | None,     # optional
              "access_level": str | None,     # optional
              "columns": [
                  {
                    "column_name":   str,            # required
                    "column_domain": str | None,     # optional
                  }, ...
              ]
            }

        All IDs (table_id, column_id) are auto-generated.
        uses_pii / uses_phi / uses_pci are always stored as NULL.
        """
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
        tool_ids_for_card: List[str] = []

        tenant_id_value = f"'{tenant_id}'," if tenant_id else ""
        tenant_id_column = "tenant_id," if tenant_id else ""

        # 1. agents table
        queries.append(f"""
        INSERT INTO {cls.CORE_DB_NAME}.agents (
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
        INSERT INTO {cls.CORE_DB_NAME}.agent_identifications (
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

        # 3. tools (ONLY name + description) + Agent→Tool data-source entries
        tool_ds_values: List[str] = []
        if tools:
            values_list = []
            for tool in tools:
                tool_id = str(uuid.uuid4())
                tool_ids_for_card.append(tool_id)
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
                # Always create Agent → Tool data-source entry
                tool_ds_values.append(
                    f"({tenant_id_value}"
                    f"'{agent_internal_id}','{agent_id}',"
                    f"NULL,NULL::boolean,NULL::boolean,NULL::boolean,"
                    f"TIMESTAMP '{now}',TIMESTAMP '{now}',"
                    f"'{agent_id}',NULL,'{cls.sanitize(agent_name)}','Agent',"
                    f"'{cls.sanitize(tool_id)}',NULL,'{name}','Tool')"
                )

            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_tools (
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
            """)

        # 4. knowledge sources
        if knowledge_source:
            ks_id   = str(uuid.uuid4())
            ks_name = cls.sanitize(knowledge_source.get("name"))
            ks_desc = cls.sanitize(knowledge_source.get("description"))
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_knowledge_sources (
                {tenant_id_column}
                agent_internal_id,
                agent_id,
                identifier,
                name,
                description,
                created_ts,
                updated_ts
            )
            VALUES (
                {tenant_id_value}
                '{agent_internal_id}',
                '{agent_id}',
                '{ks_id}',
                '{ks_name}',
                '{ks_desc}',
                TIMESTAMP '{now}',
                TIMESTAMP '{now}'
            )
            """)

        # 5. agent_data_sources
        ds_insert_columns = f"""
            {tenant_id_column}
            agent_internal_id, agent_id,
            access_level, contains_pii, contains_phi, contains_pci,
            created_ts, updated_ts,
            source_object_id, source_object_domain, source_object_name, source_object_type,
            target_object_id, target_object_domain, target_object_name, target_object_type
        """

        # Merge Agent→Tool entries (always) with Agent→Table→Column entries (if provided)
        all_ds_values: List[str] = list(tool_ds_values)
        if data_sources:
            ds_entries = cls._build_data_source_entries(agent_id, raw_agent_name, data_sources)
            if ds_entries:
                all_ds_values += cls._build_ds_sql_values(
                    ds_entries, agent_internal_id, agent_id, now,
                    tenant_id_column, tenant_id_value,
                )

        if all_ds_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources (
                {ds_insert_columns}
            )
            VALUES {','.join(all_ds_values)}
            """)

        # 6. skills — persist to core.skills and core.agent_skills
        if skills:
            def _pg_array(lst):
                if not lst:
                    return "ARRAY[]::TEXT[]"
                escaped = [f"'{cls.sanitize(str(x))}'" for x in lst if str(x).strip()]
                return f"ARRAY[{', '.join(escaped)}]" if escaped else "ARRAY[]::TEXT[]"

            tenant_id_lit = f"'{tenant_id}'" if tenant_id else "NULL"
            seen_skill_ids: set = set()
            for skill in skills:
                if isinstance(skill, str):
                    skill_name = skill.strip()
                    if not skill_name:
                        continue
                    skill_id = str(uuid.uuid4())
                    skill_dedupe_key = skill_name.lower()
                    skill_desc = ""
                    tags, input_modes, output_modes = [], [], []
                elif isinstance(skill, dict):
                    explicit_id = str(
                        skill.get("identifier") or skill.get("skill_id") or
                        skill.get("id") or ""
                    ).strip()
                    skill_name = str(
                        skill.get("name") or skill.get("skill_name") or ""
                    ).strip()
                    skill_id = explicit_id or str(uuid.uuid4())
                    if not skill_name:
                        skill_name = skill_id
                    skill_dedupe_key = (explicit_id or skill_name).lower()
                    skill_desc = str(skill.get("description") or "").strip()
                    tags = skill.get("tags") if isinstance(skill.get("tags"), list) else []
                    input_modes = skill.get("inputModes") or skill.get("input_modes") or []
                    output_modes = skill.get("outputModes") or skill.get("output_modes") or []
                    input_modes = input_modes if isinstance(input_modes, list) else []
                    output_modes = output_modes if isinstance(output_modes, list) else []
                else:
                    continue

                if skill_dedupe_key in seen_skill_ids:
                    continue
                seen_skill_ids.add(skill_dedupe_key)

                sid = cls.sanitize(skill_id)
                sname = cls.sanitize(skill_name)
                sdesc = cls.sanitize(skill_desc)

                queries.append(f"""
                INSERT INTO {cls.CORE_DB_NAME}.skills (
                    tenant_id, skill_id, name, description,
                    tags, input_modes, output_modes,
                    created_ts, updated_ts
                )
                VALUES (
                    {tenant_id_lit}, '{sid}', '{sname}', '{sdesc}',
                    {_pg_array(tags)}, {_pg_array(input_modes)}, {_pg_array(output_modes)},
                    TIMESTAMP '{now}', TIMESTAMP '{now}'
                )
                """)

                queries.append(f"""
                INSERT INTO {cls.CORE_DB_NAME}.agent_skills (
                    tenant_id, skill_id, skill_name, agent_id, agent_name,
                    agent_internal_id, created_ts, updated_ts
                )
                VALUES (
                    {tenant_id_lit}, '{sid}', '{sname}',
                    '{agent_id}', '{agent_name}',
                    '{agent_internal_id}',
                    TIMESTAMP '{now}', TIMESTAMP '{now}'
                )
                """)

        # 7. Execute
        for query in queries:
            cls.execute_dml(query)

        # 8. Write agent card JSON so get_agent_card returns full details immediately
        cls._write_agent_card(
            agent_id=agent_id,
            agent_internal_id=agent_internal_id,
            agent_name=raw_agent_name,
            description=raw_description,
            instruction=raw_instruction,
            tools=tools,
            knowledge_source=knowledge_source,
            tool_ids=tool_ids_for_card,
            skills=skills,
            data_sources=data_sources,
        )

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
            "message": "Agent created successfully and Risk Assessment is also triggered."
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
        INSERT INTO {cls.CORE_DB_NAME}.ai_use_cases (
            tenant_id,
            ai_use_case_id,
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
        rel_tenant_where = ""

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
                    u.tenant_id = '{tenant_id}'
                    OR u.tenant_id IS NULL
                    OR u.tenant_id = ''
                    OR u.tenant_id = 'None'
                )""")
                rel_tenant_where = f"""
                    AND (
                        rel.tenant_id = '{tenant_id}'
                        OR rel.tenant_id IS NULL
                        OR rel.tenant_id = ''
                        OR rel.tenant_id = 'None'
                    )
                """
            where_clauses.append(f"u.ai_use_case_id = '{use_case_id}'")
            start, end = 1, 1
        else:
            # ---------- 4. GLOBAL MODE ----------
            if tenant_mode == "GLOBAL":
                # No tenant filter → full access
                pass
            # ---------- 5. TENANT MODE ----------
            else:
                where_clauses.append(f"""(
                    u.tenant_id = '{tenant_id}'
                    OR u.tenant_id IS NULL
                    OR u.tenant_id = ''
                    OR u.tenant_id = 'None'
                )""")
                rel_tenant_where = f"""
                    AND (
                        rel.tenant_id = '{tenant_id}'
                        OR rel.tenant_id IS NULL
                        OR rel.tenant_id = ''
                        OR rel.tenant_id = 'None'
                    )
                """

        if title:
            title = cls.sanitize(title)
            where_clauses.append(f"LOWER(u.name) LIKE LOWER('%{title}%')")

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        # ---------- 3. Detail Query (single use-case with aggregated linked agents) ----------
        if use_case_id:
            detail_query = f"""
                SELECT
                    u.ai_use_case_id AS identifier,
                    u.ai_use_case_id,
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
                                    COALESCE(ag.agent_name, rel.agent_name) AS agent_name,
                                    ai.environment AS environment
                                FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
                                LEFT JOIN {cls.CORE_DB_NAME}.agents ag
                                    ON ag.agent_id = rel.agent_id
                                   AND ag.is_current = true
                                LEFT JOIN {cls.CORE_DB_NAME}.agent_identifications ai
                                    ON ai.agent_internal_id = rel.agent_internal_id
                                   AND COALESCE(ai.is_current, true) = true
                                WHERE rel.ai_use_case_id = u.ai_use_case_id
                                  AND rel.agent_id IS NOT NULL
                                  AND rel.agent_id <> ''
                                  {rel_tenant_where}
                            ) agent_rows
                        ),
                        '[]'::json
                    ) AS of_associated_agents
                FROM {cls.CORE_DB_NAME}.ai_use_cases u
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
                    "use_case_id": row.get("ai_use_case_id"),
                    "identifier": row.get("ai_use_case_id"),
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
                    u.ai_use_case_id AS use_case_id,
                    u.ai_use_case_id AS identifier,
                    u.name,
                    u.description,
                    u.owner,
                    u.problem_statement,
                    u.expected_benefits,
                    u.priority,
                    u.status,
                    u.solution_approach,
                    u.created_ts,
                    COALESCE(
                        (
                            SELECT COUNT(DISTINCT rel.agent_id)
                            FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
                            WHERE rel.ai_use_case_id = u.ai_use_case_id
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {rel_tenant_where}
                        ),
                        0
                    ) AS related_agent_count,
                    COALESCE(
                        (
                            SELECT COUNT(DISTINCT rel.agent_id)
                            FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
                            WHERE rel.ai_use_case_id = u.ai_use_case_id
                              AND rel.agent_id IS NOT NULL
                              AND rel.agent_id <> ''
                              {rel_tenant_where}
                        ),
                        0
                    ) AS no_of_associated_agents,
                    ROW_NUMBER() OVER (ORDER BY u.created_ts DESC) AS rn,
                    COUNT(*) OVER () AS total_records
                FROM {cls.CORE_DB_NAME}.ai_use_cases u
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
                "use_case_id": row_dict.get("use_case_id"),
                "identifier": row_dict.get("identifier"),
                "title": row_dict.get("name"),
                "description": row_dict.get("description"),
                "owner": row_dict.get("owner"),
                "problem_statement": row_dict.get("problem_statement"),
                "expected_benefits": row_dict.get("expected_benefits"),
                "priority": row_dict.get("priority"),
                "status": row_dict.get("status"),
                "solution_approach": row_dict.get("solution_approach"),
                "created_ts": row_dict.get("created_ts"),
                "related_agent_count": row_dict.get("related_agent_count"),
                "no_of_associated_agents": row_dict.get("no_of_associated_agents"),
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
    def _sync_ai_use_case_risk_summary(
        cls,
        ai_use_case_id: str,
        tenant_id: Optional[str],
        now: str
    ) -> int:
        tenant_clean = cls.sanitize(str(tenant_id).strip()) if tenant_id else None
        tenant_rel_where = (
            f"AND (rel.tenant_id = '{tenant_clean}' OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
            if tenant_clean else ""
        )
        tenant_uc_where = (
            f"AND (tenant_id = '{tenant_clean}' OR tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'None')"
            if tenant_clean else ""
        )

        remaining_agents_q = f"""
            SELECT DISTINCT rel.agent_internal_id
            FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
            WHERE rel.ai_use_case_id = '{ai_use_case_id}'
              AND COALESCE(rel.agent_internal_id, '') <> ''
              {tenant_rel_where}
        """
        remaining_rows = cls.execute_select(remaining_agents_q)
        remaining_ids = [r.get("agent_internal_id") for r in remaining_rows if r.get("agent_internal_id")]
        associated_count = len(remaining_ids)

        if associated_count == 0:
            reset_q = f"""
                UPDATE {cls.CORE_DB_NAME}.ai_use_cases
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
                WHERE ai_use_case_id = '{ai_use_case_id}'
                  {tenant_uc_where}
            """
            cls.execute_dml(reset_q)
            return 0

        ids_sql = ", ".join([f"'{cls.sanitize(str(x))}'" for x in remaining_ids])
        metrics_q = f"""
            WITH risk_metrics AS (
                SELECT
                    MAX(blended_risk_score) AS max_score,
                    (
                        SELECT agent_internal_id
                        FROM {cls.CORE_DB_NAME}.agent_risk_assessments
                        WHERE agent_internal_id IN ({ids_sql})
                        ORDER BY blended_risk_score DESC
                        LIMIT 1
                    ) AS worst_agent_id
                FROM {cls.CORE_DB_NAME}.agent_risk_assessments
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
        if worst_agent_id and cls.RISK_MANAGEMENT_DB_NAME:
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
            UPDATE {cls.CORE_DB_NAME}.ai_use_cases
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
            WHERE ai_use_case_id = '{ai_use_case_id}'
              {tenant_uc_where}
        """
        cls.execute_dml(sync_q)
        return associated_count

    @classmethod
    def create_ai_use_case_agent_relationship(
        cls,
        agent_catalog_id: int,
        ai_use_case_id: int,
        tenant_id: Optional[str] = None
    ):
        if not agent_catalog_id or not ai_use_case_id:
            raise ValueError("Both IDs are required.")

        if not tenant_id or str(tenant_id).strip().lower() in ("none", "null", ""):
            tenant_id = None

        agent_catalog_id = cls.sanitize(str(agent_catalog_id).strip())
        ai_use_case_id = cls.sanitize(str(ai_use_case_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        tenant_clean = cls.sanitize(str(tenant_id).strip()) if tenant_id else None

        tenant_where_rel = (
            f"AND (rel.tenant_id = '{tenant_clean}' OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
            if tenant_clean else ""
        )
        tenant_where_uc = (
            f"AND (u.tenant_id = '{tenant_clean}' OR u.tenant_id IS NULL OR u.tenant_id = '' OR u.tenant_id = 'None')"
            if tenant_clean else ""
        )

        use_case_q = f"""
            SELECT u.ai_use_case_id, u.name
            FROM {cls.CORE_DB_NAME}.ai_use_cases u
            WHERE u.ai_use_case_id = '{ai_use_case_id}'
              {tenant_where_uc}
            LIMIT 1
        """
        use_case_rows = cls.execute_select(use_case_q)
        if not use_case_rows:
            raise ValueError(f"AI Use Case {ai_use_case_id} not found.")
        use_case_name = cls.sanitize(str(use_case_rows[0].get("name") or ai_use_case_id))

        check_q = f"""
            SELECT 1
            FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
            WHERE rel.ai_use_case_id = '{ai_use_case_id}'
              AND rel.agent_id = '{agent_catalog_id}'
              {tenant_where_rel}
            LIMIT 1
        """
        is_duplicate = len(cls.execute_select(check_q)) > 0

        agent_q = f"""
            SELECT agent_id, agent_internal_id, agent_name
            FROM {cls.CORE_DB_NAME}.agents
            WHERE agent_id = '{agent_catalog_id}'
              AND COALESCE(is_current, true) = true
            LIMIT 1
        """
        agent_res = cls.execute_select(agent_q)
        if not agent_res:
            agent_res = cls.execute_select(
                f"SELECT agent_id, agent_internal_id, agent_name FROM {cls.CURATED_DB_NAME}.agent_360 WHERE agent_id = '{agent_catalog_id}' LIMIT 1"
            )
        if not agent_res:
            raise ValueError(f"Agent {agent_catalog_id} not found.")
        target_internal_id = agent_res[0].get("agent_internal_id")
        target_agent_name = cls.sanitize(str(agent_res[0].get("agent_name") or agent_catalog_id))

        if not is_duplicate:
            action_q = f"""
                INSERT INTO {cls.CORE_DB_NAME}.agent_ai_use_cases (
                    tenant_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name,
                    agent_internal_id, created_ts, updated_ts
                ) VALUES (
                    {f"'{tenant_clean}'" if tenant_clean else "NULL"},
                    '{ai_use_case_id}',
                    '{use_case_name}',
                    '{agent_catalog_id}',
                    '{target_agent_name}',
                    '{target_internal_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                ON CONFLICT (tenant_id, ai_use_case_id, agent_id)
                DO UPDATE SET
                    ai_use_case_name = EXCLUDED.ai_use_case_name,
                    agent_name = EXCLUDED.agent_name,
                    agent_internal_id = EXCLUDED.agent_internal_id,
                    updated_ts = EXCLUDED.updated_ts
            """
            cls.execute_dml(action_q)

        associated_count = cls._sync_ai_use_case_risk_summary(
            ai_use_case_id=ai_use_case_id,
            tenant_id=tenant_id,
            now=now,
        )
        return {"message": "Relationship synchronized", "associated_count": associated_count}

    @classmethod
    def remove_ai_use_case_agent_relationship(
        cls,
        agent_catalog_id: str,
        ai_use_case_id: str,
        tenant_id: Optional[str] = None
    ):
        if not agent_catalog_id or not ai_use_case_id:
            raise ValueError("Both IDs are required.")

        if not tenant_id or str(tenant_id).strip().lower() in ("none", "null", ""):
            tenant_id = None

        agent_catalog_id = cls.sanitize(str(agent_catalog_id).strip())
        ai_use_case_id = cls.sanitize(str(ai_use_case_id).strip())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        tenant_clean = cls.sanitize(str(tenant_id).strip()) if tenant_id else None

        tenant_where_rel = (
            f"AND (rel.tenant_id = '{tenant_clean}' OR rel.tenant_id IS NULL OR rel.tenant_id = '' OR rel.tenant_id = 'None')"
            if tenant_clean else ""
        )
        tenant_where_uc = (
            f"AND (u.tenant_id = '{tenant_clean}' OR u.tenant_id IS NULL OR u.tenant_id = '' OR u.tenant_id = 'None')"
            if tenant_clean else ""
        )

        use_case_q = f"""
            SELECT 1
            FROM {cls.CORE_DB_NAME}.ai_use_cases u
            WHERE u.ai_use_case_id = '{ai_use_case_id}'
              {tenant_where_uc}
            LIMIT 1
        """
        if not cls.execute_select(use_case_q):
            raise ValueError(f"AI Use Case {ai_use_case_id} not found.")

        check_rel_q = f"""
            SELECT 1
            FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
            WHERE rel.ai_use_case_id = '{ai_use_case_id}'
              AND rel.agent_id = '{agent_catalog_id}'
              {tenant_where_rel}
            LIMIT 1
        """
        if not cls.execute_select(check_rel_q):
            associated_count = cls._sync_ai_use_case_risk_summary(
                ai_use_case_id=ai_use_case_id,
                tenant_id=tenant_id,
                now=now,
            )
            return {"message": "Relationship not found", "associated_count": associated_count}

        delete_q = f"""
            DELETE FROM {cls.CORE_DB_NAME}.agent_ai_use_cases rel
            WHERE rel.ai_use_case_id = '{ai_use_case_id}'
              AND rel.agent_id = '{agent_catalog_id}'
              {tenant_where_rel}
        """
        cls.execute_dml(delete_q)

        associated_count = cls._sync_ai_use_case_risk_summary(
            ai_use_case_id=ai_use_case_id,
            tenant_id=tenant_id,
            now=now,
        )
        return {"message": "Relationship removed", "associated_count": associated_count}

    @classmethod
    def update_agent(
        cls,
        agent_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        description: Optional[str] = None,
        instruction: Optional[str] = None,
        tools: Optional[List[Dict[str, str]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        skills: Optional[List[Any]] = None,
        tenant_id: Optional[str] = None,
        data_sources: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing agent.  Only provided fields are changed.

        ``tools`` — when provided (including an empty list), replaces all existing
        tool records and their Agent→Tool data-source entries.  Omit to leave
        existing tools unchanged.

        ``data_sources`` — when provided (including an empty list), replaces all
        existing Agent→Table and Table→Column data-source entries.  Agent→Tool
        entries are NEVER touched by this parameter.  Omit to leave existing
        data sources unchanged.

        All IDs (tool_id, table_id, column_id) are auto-generated.
        uses_pii / uses_phi / uses_pci are always stored as NULL.
        """
        # tenant_id is mandatory for all updates
        if not tenant_id or str(tenant_id).strip().lower() in ["none", "null", ""]:
            raise ValueError("tenant_id is required to update an agent.")

        if not agent_id and not agent_name:
            raise ValueError("Either agent_id or agent_name is required.")

        # Tenant context - always present after validation above
        tenant_clean = cls.sanitize(str(tenant_id).strip())
        tenant_where = f"AND tenant_id = '{tenant_clean}'"
        tenant_col = "tenant_id,"
        tenant_val = f"'{tenant_clean}',"
        tenant_lit = f"'{tenant_clean}'"
        is_tenant = True
        # Resolve agent ID
        if not agent_id:
            agent_id = cls._get_agent_id_from_name(agent_name, tenant_id)
            if not agent_id:
                raise ValueError(f"Agent '{agent_name}' not found.")
        agent_id = cls.sanitize(str(agent_id).strip())

        # Fetch current agent record
        rows = cls.execute_select(
            f"SELECT agent_internal_id, agent_name FROM {cls.CORE_DB_NAME}.agents "
            f"WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where} LIMIT 1"
        )
        if not rows:
            raise ValueError(f"Agent '{agent_id}' not found.")

        agent_internal_id = rows[0].get("agent_internal_id")
        current_agent_name = rows[0].get("agent_name") or ""
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Effective name used for data-source source labels
        effective_agent_name = (
            str(agent_name).strip()
            if (agent_name is not None and str(agent_name).strip())
            else current_agent_name
        )

        # Update agent_name
        if agent_name is not None and str(agent_name).strip():
            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.agents "
                f"SET agent_name = '{cls.sanitize(agent_name)}', updated_ts = TIMESTAMP '{now}' "
                f"WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}"
            )

        # Update description
        if description is not None and str(description).strip():
            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.agents "
                f"SET agent_description = '{cls.sanitize(description)}', updated_ts = TIMESTAMP '{now}' "
                f"WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}"
            )

        # Update instruction (version the old row, insert a new current one)
        if instruction:
            instr = cls.sanitize(instruction)
            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.agent_identifications "
                f"SET is_current = false, updated_ts = TIMESTAMP '{now}' "
                f"WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}"
            )
            cls.execute_dml(
                f"INSERT INTO {cls.CORE_DB_NAME}.agent_identifications "
                f"({tenant_col}agent_internal_id, agent_id, instruction, created_ts, updated_ts, is_current) "
                f"VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', '{instr}', "
                f"TIMESTAMP '{now}', TIMESTAMP '{now}', true)"
            )

        # Update tools — None means "leave unchanged"; [] means "clear all tools"
        # Agent→Tool data-source entries are kept in sync with agent_tools.
        if tools is not None:
            # Remove existing tool records
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_tools "
                f"WHERE agent_id = '{agent_id}' {tenant_where}"
            )
            # Remove existing Agent→Tool data-source entries only (Table/Column entries untouched)
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_data_sources "
                f"WHERE agent_internal_id = '{agent_internal_id}' "
                f"AND target_object_type = 'Tool'"
            )
            if tools:
                tool_rows: List[str] = []
                tool_ds_rows: List[str] = []
                for t in tools:
                    tool_id = str(uuid.uuid4())
                    t_name = cls.sanitize(t.get("name", ""))
                    t_desc = cls.sanitize(t.get("description", ""))
                    tool_rows.append(
                        f"({tenant_val}'{agent_internal_id}', '{tool_id}', '{agent_id}', "
                        f"'{t_name}', '{t_desc}', TIMESTAMP '{now}', TIMESTAMP '{now}')"
                    )
                    tool_ds_rows.append(
                        f"({tenant_val}'{agent_internal_id}', '{agent_id}', "
                        f"NULL, NULL::boolean, NULL::boolean, NULL::boolean, "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}', "
                        f"'{agent_id}', NULL, '{cls.sanitize(effective_agent_name)}', 'Agent', "
                        f"'{tool_id}', NULL, '{t_name}', 'Tool')"
                    )
                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.agent_tools "
                    f"({tenant_col}agent_internal_id, tool_id, agent_id, tool_name, tool_description, created_ts, updated_ts) "
                    f"VALUES {','.join(tool_rows)}"
                )
                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources "
                    f"({tenant_col}agent_internal_id, agent_id, "
                    f"access_level, contains_pii, contains_phi, contains_pci, "
                    f"created_ts, updated_ts, "
                    f"source_object_id, source_object_domain, source_object_name, source_object_type, "
                    f"target_object_id, target_object_domain, target_object_name, target_object_type) "
                    f"VALUES {','.join(tool_ds_rows)}"
                )

        # Update knowledge source — when provided, replace existing
        if knowledge_source:
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_knowledge_sources "
                f"WHERE agent_id = '{agent_id}' {tenant_where}"
            )
            ks_id = str(uuid.uuid4())
            ks_name = cls.sanitize(knowledge_source.get("name", ""))
            ks_desc = cls.sanitize(knowledge_source.get("description", ""))
            cls.execute_dml(
                f"INSERT INTO {cls.CORE_DB_NAME}.agent_knowledge_sources "
                f"({tenant_col}agent_internal_id, agent_id, identifier, name, description, created_ts, updated_ts) "
                f"VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', '{ks_id}', "
                f"'{ks_name}', '{ks_desc}', TIMESTAMP '{now}', TIMESTAMP '{now}')"
            )

        # Update data sources — None means "leave unchanged"; [] means "clear Table/Column entries"
        # Agent→Tool entries are NEVER touched here; they are managed by the tools block above.
        if data_sources is not None:
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_data_sources "
                f"WHERE agent_internal_id = '{agent_internal_id}' "
                f"AND target_object_type IN ('Table', 'Column')"
            )
            if data_sources:
                ds_entries = cls._build_data_source_entries(agent_id, effective_agent_name, data_sources)
                if ds_entries:
                    ds_sql_values = cls._build_ds_sql_values(
                        ds_entries, agent_internal_id, agent_id, now,
                        tenant_col, tenant_val,
                    )
                    cls.execute_dml(f"""
                        INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources (
                            {tenant_col}
                            agent_internal_id, agent_id,
                            access_level, contains_pii, contains_phi, contains_pci,
                            created_ts, updated_ts,
                            source_object_id, source_object_domain, source_object_name, source_object_type,
                            target_object_id, target_object_domain, target_object_name, target_object_type
                        )
                        VALUES {','.join(ds_sql_values)}
                    """)

        if skills is not None:
            def _pg_array(lst):
                if not lst:
                    return "ARRAY[]::TEXT[]"
                escaped = [f"'{cls.sanitize(str(x))}'" for x in lst if str(x).strip()]
                return f"ARRAY[{', '.join(escaped)}]" if escaped else "ARRAY[]::TEXT[]"

            def _list_text_values(value):
                if isinstance(value, list):
                    return [str(v).strip() for v in value if str(v).strip()]
                if isinstance(value, str):
                    stripped = value.strip()
                    if not stripped:
                        return []
                    if "," in stripped:
                        return [part.strip() for part in stripped.split(",") if part.strip()]
                    return [stripped]
                return []

            def _first_present(mapping, *keys):
                for key in keys:
                    if key in mapping and mapping[key] is not None:
                        return mapping[key]
                return None

            def _has_any_key(mapping, *keys):
                return any(key in mapping for key in keys)

            def _clean_text(value):
                return str(value or "").strip()

            def _existing_list(value):
                return _list_text_values(value)

            rel_tenant_where = f"AND rel.tenant_id = '{tenant_clean}'" if is_tenant else ""
            existing_skill_rows = cls.execute_select(f"""
                SELECT rel.skill_id, rel.skill_name, s.name, s.description,
                       s.tags, s.input_modes, s.output_modes
                FROM {cls.CORE_DB_NAME}.agent_skills rel
                LEFT JOIN {cls.CORE_DB_NAME}.skills s
                  ON LOWER(TRIM(s.skill_id)) = LOWER(TRIM(rel.skill_id))
                 AND COALESCE(s.tenant_id, '') = COALESCE(rel.tenant_id, '')
                WHERE rel.agent_id = '{agent_id}'
                  {rel_tenant_where}
                  AND rel.skill_id IS NOT NULL
                  AND rel.skill_id <> ''
            """)
            existing_skills = []
            for row in existing_skill_rows:
                existing_sid = _clean_text(row.get("skill_id"))
                if not existing_sid:
                    continue
                existing_skills.append({
                    "skill_id": existing_sid,
                    "skill_name": _clean_text(row.get("name") or row.get("skill_name") or existing_sid),
                    "description": _clean_text(row.get("description")),
                    "tags": _existing_list(row.get("tags")),
                    "input_modes": _existing_list(row.get("input_modes")),
                    "output_modes": _existing_list(row.get("output_modes")),
                })

            def _find_existing_skill(explicit_id, skill_name, single_skill_patch):
                explicit_key = _clean_text(explicit_id).lower()
                name_key = _clean_text(skill_name).lower()
                for row in existing_skills:
                    if explicit_key and row["skill_id"].lower() == explicit_key:
                        return row
                for row in existing_skills:
                    candidates = {row["skill_id"].lower(), row["skill_name"].lower()}
                    if name_key and name_key in candidates:
                        return row
                if single_skill_patch and len(existing_skills) == 1:
                    return existing_skills[0]
                return None

            skill_rows = []
            seen_skill_ids: set = set()
            single_skill_patch = len(skills or []) == 1
            for skill in skills:
                existing_match = None
                if isinstance(skill, str):
                    skill_name = skill.strip()
                    existing_match = _find_existing_skill(skill_name, skill_name, single_skill_patch)
                    if existing_match:
                        skill_id = existing_match["skill_id"]
                        skill_name = existing_match["skill_name"]
                        skill_desc = existing_match["description"]
                        tags = existing_match["tags"]
                        input_modes = existing_match["input_modes"]
                        output_modes = existing_match["output_modes"]
                    else:
                        skill_id = str(uuid.uuid4())
                        skill_desc = ""
                        tags, input_modes, output_modes = [], [], []
                elif isinstance(skill, dict):
                    explicit_id = _clean_text(_first_present(skill, "identifier", "skill_id", "id"))
                    requested_name = _clean_text(skill.get("name") or skill.get("skill_name"))
                    fallback_name = requested_name or explicit_id
                    existing_match = _find_existing_skill(explicit_id, fallback_name, single_skill_patch)
                    skill_id = existing_match["skill_id"] if existing_match else (explicit_id or str(uuid.uuid4()))
                    skill_name = requested_name or (existing_match["skill_name"] if existing_match else skill_id)
                    skill_desc = (
                        _clean_text(skill.get("description"))
                        if "description" in skill
                        else (existing_match["description"] if existing_match else "")
                    )
                    tags = (
                        _list_text_values(skill.get("tags"))
                        if "tags" in skill
                        else (existing_match["tags"] if existing_match else [])
                    )
                    input_modes = (
                        _list_text_values(_first_present(
                            skill, "inputModes", "input_modes", "inputBounds", "input_bounds", "inputs", "input"
                        ))
                        if _has_any_key(skill, "inputModes", "input_modes", "inputBounds", "input_bounds", "inputs", "input")
                        else (existing_match["input_modes"] if existing_match else [])
                    )
                    output_modes = (
                        _list_text_values(_first_present(
                            skill, "outputModes", "output_modes", "outputBounds", "output_bounds", "outputs", "output"
                        ))
                        if _has_any_key(skill, "outputModes", "output_modes", "outputBounds", "output_bounds", "outputs", "output")
                        else (existing_match["output_modes"] if existing_match else [])
                    )
                else:
                    continue

                if not skill_id:
                    continue
                skill_key = skill_id.lower()
                if skill_key in seen_skill_ids:
                    continue
                seen_skill_ids.add(skill_key)
                skill_rows.append({
                    "skill_id": cls.sanitize(skill_id),
                    "skill_name": cls.sanitize(skill_name),
                    "description": cls.sanitize(skill_desc),
                    "tags": tags,
                    "input_modes": input_modes,
                    "output_modes": output_modes,
                })

            for skill in skill_rows:
                cls.execute_dml(f"""
                    INSERT INTO {cls.CORE_DB_NAME}.skills (
                        tenant_id, skill_id, name, description,
                        tags, input_modes, output_modes,
                        created_ts, updated_ts
                    )
                    VALUES (
                        {tenant_lit}, '{skill["skill_id"]}', '{skill["skill_name"]}', '{skill["description"]}',
                        {_pg_array(skill["tags"])}, {_pg_array(skill["input_modes"])}, {_pg_array(skill["output_modes"])},
                        TIMESTAMP '{now}', TIMESTAMP '{now}'
                    )
                    ON CONFLICT (tenant_id, skill_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        tags = EXCLUDED.tags,
                        input_modes = EXCLUDED.input_modes,
                        output_modes = EXCLUDED.output_modes,
                        updated_ts = EXCLUDED.updated_ts
                """)
                cls.execute_dml(f"""
                    INSERT INTO {cls.CORE_DB_NAME}.agent_skills (
                        tenant_id, skill_id, skill_name, agent_id, agent_name,
                        agent_internal_id, created_ts, updated_ts
                    )
                    VALUES (
                        {tenant_lit}, '{skill["skill_id"]}', '{skill["skill_name"]}',
                        '{agent_id}', '{cls.sanitize(effective_agent_name)}',
                        '{agent_internal_id}',
                        TIMESTAMP '{now}', TIMESTAMP '{now}'
                    )
                    ON CONFLICT (tenant_id, skill_id, agent_id) DO UPDATE SET
                        skill_name = EXCLUDED.skill_name,
                        agent_name = EXCLUDED.agent_name,
                        agent_internal_id = EXCLUDED.agent_internal_id,
                        updated_ts = EXCLUDED.updated_ts
                """)

        # Refresh curated snapshot and local card so downstream reads reflect changes immediately
        try:
            refresh_curated_agent_360(agent_internal_id, agent_id, tenant_id)
            create_local_agent_card(agent_internal_id)
            print(f"[update_agent] Refreshed agent_360 and local card for agent_id={agent_id}")
        except Exception as refresh_err:
            # Non-fatal: the update is committed; only the cached views are stale.
            print(f"[update_agent] Warning: post-update refresh failed (changes are saved): {refresh_err}")

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
            f"SELECT agent_internal_id FROM {cls.CORE_DB_NAME}.agents WHERE agent_id = '{agent_id}' LIMIT 1"
        )
        if not rows:
            raise ValueError(f"Agent {agent_id} not found.")
        agent_internal_id = cls.sanitize(str(rows[0]["agent_internal_id"]))

        # 1. Remove agent relationships and refresh association counts on impacted use cases.
        cls.execute_dml(f"""
            WITH deleted_rel AS (
                DELETE FROM {cls.CORE_DB_NAME}.agent_ai_use_cases
                WHERE agent_id = '{agent_id}'
                RETURNING ai_use_case_id
            ),
            affected AS (
                SELECT DISTINCT ai_use_case_id
                FROM deleted_rel
                WHERE ai_use_case_id IS NOT NULL AND ai_use_case_id <> ''
            ),
            counts AS (
                SELECT
                    a.ai_use_case_id,
                    COUNT(DISTINCT rel.agent_id) AS associated_count
                FROM affected a
                LEFT JOIN {cls.CORE_DB_NAME}.agent_ai_use_cases rel
                  ON rel.ai_use_case_id = a.ai_use_case_id
                 AND rel.agent_id IS NOT NULL
                 AND rel.agent_id <> ''
                GROUP BY a.ai_use_case_id
            )
            UPDATE {cls.CORE_DB_NAME}.ai_use_cases uc
            SET
                no_of_associated_agents = c.associated_count,
                updated_ts = CURRENT_TIMESTAMP
            FROM counts c
            WHERE uc.ai_use_case_id = c.ai_use_case_id
        """)

        # 2. Core tables — all keyed on agent_id or agent_internal_id
        for table in ("agent_tools", "agent_knowledge_sources", "agent_data_sources", "agent_identifications"):
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.{table} WHERE agent_id = '{agent_id}'"
            )

        cls.execute_dml(
            f"DELETE FROM {cls.CORE_DB_NAME}.agent_risk_assessments WHERE agent_internal_id = '{agent_internal_id}'"
        )
        cls.execute_dml(
            f"DELETE FROM {cls.CORE_DB_NAME}.agents WHERE agent_id = '{agent_id}'"
        )

        # 3. Curated snapshot
        if cls.CURATED_DB_NAME:
            cls.execute_dml(
                f"DELETE FROM {cls.CURATED_DB_NAME}.agent_360 WHERE agent_internal_id = '{agent_internal_id}'"
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
        use_case_id: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        business_problem_statement: Optional[str] = None,
        expected_benefits: Optional[str] = None,
        priority: Optional[str] = None,
        regulatory_impact: Optional[List[str]] = None,
        solution_approach: Optional[str] = None,
        use_case_owner: Optional[str] = None,
        impacted_business_applications: Optional[List[str]] = None,
        impacted_business_processes: Optional[List[str]] = None,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update an existing AI use case.

        Rules:
        - use_case_id is required.
        - Only provided fields are updated.
        - Existing values remain unchanged if field not provided.
        """

        # ---------- 1. Validation ----------
        if not use_case_id or not str(use_case_id).strip():
            raise ValueError("use_case_id is required for update.")

        use_case_id_clean = cls.sanitize(str(use_case_id).strip())

        # ---------- 2. Normalize tenant ----------
        if not tenant_id or str(tenant_id).strip().lower() in ["none", "null", ""]:
            tenant_where = ""
        else:
            tenant_where = f"AND tenant_id = '{cls.sanitize(str(tenant_id).strip())}'"

        # ---------- 3. Fetch Existing Record ----------
        query = f"""
            SELECT *
            FROM {cls.CORE_DB_NAME}.ai_use_cases
            WHERE ai_use_case_id = '{use_case_id_clean}'
            {tenant_where}
            LIMIT 1
        """

        rows = cls.execute_select(query)

        if not rows:
            raise ValueError(f"AI Use Case '{use_case_id_clean}' not found.")

        current = rows[0]

        existing_cols_rows = cls.execute_select(
            f"""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = '{cls.sanitize(cls.CORE_DB_NAME)}'
              AND table_name = 'ai_use_cases'
            """
        )
        existing_cols = {str(r.get("column_name", "")).strip() for r in existing_cols_rows}

        # ---------- 4. Helpers ----------
        def clean_list(items):
            if not items:
                return None
            return ", ".join([
                str(item).strip()
                for item in items
                if str(item).strip()
            ])

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        updates = []

        # ---------- 5. Dynamic Updates ----------
        if name is not None:
            updates.append(
                f"name = '{cls.sanitize(name)}'"
            )

        if description is not None:
            updates.append(
                f"description = '{cls.sanitize(description)}'"
            )

        if business_problem_statement is not None:
            updates.append(
                f"problem_statement = '{cls.sanitize(business_problem_statement)}'"
            )

        if expected_benefits is not None:
            updates.append(
                f"expected_benefits = '{cls.sanitize(expected_benefits)}'"
            )

        if priority is not None:
            normalized_priority = cls._normalize_use_case_priority(priority)

            updates.append(
                f"priority = '{cls.sanitize(normalized_priority)}'"
            )

        if regulatory_impact is not None and "regulatory_impact" in existing_cols:
            regulatory_impact_str = clean_list(regulatory_impact)

            updates.append(
                f"regulatory_impact = '{cls.sanitize(regulatory_impact_str or '')}'"
            )

        if solution_approach is not None:
            updates.append(
                f"solution_approach = '{cls.sanitize(solution_approach)}'"
            )

        if use_case_owner is not None:
            updates.append(
                f"owner = '{cls.sanitize(use_case_owner)}'"
            )

        if impacted_business_applications is not None and "impacted_business_applications" in existing_cols:
            applications_str = clean_list(impacted_business_applications)

            updates.append(
                f"impacted_business_applications = '{cls.sanitize(applications_str or '')}'"
            )

        if impacted_business_processes is not None and "impacted_business_processes" in existing_cols:
            processes_str = clean_list(impacted_business_processes)

            updates.append(
                f"impacted_business_processes = '{cls.sanitize(processes_str or '')}'"
            )

        # ---------- 6. No-op Handling ----------
        if not updates:
            return {
                "message": "No fields provided for update.",
                "use_case_id": use_case_id_clean,
            }

        # ---------- 7. Timestamp ----------
        updates.append(
            f"updated_ts = TIMESTAMP '{now}'"
        )

        # ---------- 8. Execute Update ----------
        update_query = f"""
            UPDATE {cls.CORE_DB_NAME}.ai_use_cases
            SET
                {", ".join(updates)}
            WHERE ai_use_case_id = '{use_case_id_clean}'
            {tenant_where}
        """

        cls.execute_dml(update_query)

        # ---------- 9. Response ----------
        return {
            "message": "AI Use Case updated successfully.",
            "use_case_id": use_case_id_clean,
        }

    @classmethod
    def get_application_catalog(
        cls,
        start_record: int = 1,
        max_records: int = 10,
        record_range: str = "1-10",
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retrieve paginated application catalog with single optimized query.
        """
        start, end = cls._resolve_record_window(
            start_record=start_record,
            max_records=max_records,
            record_range=record_range
        )

        tenant_where = (
            f"WHERE tenant_id = '{cls.sanitize(tenant_id)}'"
            if tenant_id and str(tenant_id).strip().lower() not in ["none", "null", ""]
            else ""
        )

        query = f"""
            SELECT *,
                ROW_NUMBER() OVER () AS rn,
                COUNT(*) OVER () AS total_records
            FROM {cls.CORE_DB_NAME}.business_applications
            {tenant_where}
        """

        result_rows = cls.execute_select(query)

        total = 0
        rows = []
        for row in result_rows:
            if not total and row.get("total_records"):
                total = int(row["total_records"])
            rn = int(row.pop("rn", 0))
            row.pop("total_records", None)
            if start <= rn <= end:
                rows.append(row)

        return {
            "start_record": start,
            "end_record": end,
            "record_count": len(rows),
            "total_records": total,
            "data": rows
        }

    @classmethod
    def get_process_catalog(
        cls,
        start_record: int = 1,
        max_records: int = 10,
        record_range: str = "1-10",
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retrieve paginated process catalog with single optimized query.
        """
        start, end = cls._resolve_record_window(
            start_record=start_record,
            max_records=max_records,
            record_range=record_range
        )

        tenant_where = (
            f"WHERE tenant_id = '{cls.sanitize(tenant_id)}'"
            if tenant_id and str(tenant_id).strip().lower() not in ["none", "null", ""]
            else ""
        )

        query = f"""
            SELECT *,
                ROW_NUMBER() OVER () AS rn,
                COUNT(*) OVER () AS total_records
            FROM {cls.CORE_DB_NAME}.business_processes
            {tenant_where}
        """

        result_rows = cls.execute_select(query)

        total = 0
        rows = []
        for row in result_rows:
            if not total and row.get("total_records"):
                total = int(row["total_records"])
            rn = int(row.pop("rn", 0))
            row.pop("total_records", None)
            if start <= rn <= end:
                rows.append(row)

        return {
            "start_record": start,
            "end_record": end,
            "record_count": len(rows),
            "total_records": total,
            "data": rows
        }

    @classmethod
    def create_company(
        cls,
        name: str,
        industry: str,
        region: str,
        legal_entity: str,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create company via external API.
        """

        if not name or not str(name).strip():
            raise ValueError("name is required.")

        payload = {
            "name": name,
            "industry": industry,
            "region": region,
            "legal_entity": legal_entity,
        }

        try:
            response = requests.post(
                COMPANY_API_BASE_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "accept": "application/json"
                },
                timeout=30
            )

            if response.status_code not in [200, 201]:
                raise ValueError(
                    f"Company create failed: {response.status_code} - {response.text}"
                )

            data = response.json()

            return {
                "message": "Company created successfully.",
                "company_id": data.get("id"),
                "name": data.get("name"),
                "industry": data.get("industry"),
                "region": data.get("region"),
                "legal_entity": data.get("legal_entity"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            }

        except requests.RequestException as e:
            raise ValueError(f"Company API request failed: {str(e)}")


    # =========================================================
    # GET COMPANY
    # =========================================================

    @classmethod
    def get_company(
        cls,
        company_id: str,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get company by ID via external API.
        """

        if not company_id or not str(company_id).strip():
            raise ValueError("company_id is required.")

        url = f"{COMPANY_API_BASE_URL}/{company_id}"

        try:
            response = requests.get(
                url,
                headers={"accept": "application/json"},
                timeout=30
            )

            if response.status_code != 200:
                raise ValueError(
                    f"Company fetch failed: {response.status_code} - {response.text}"
                )

            data = response.json()

            return {
                "company_id": data.get("id"),
                "name": data.get("name"),
                "industry": data.get("industry"),
                "region": data.get("region"),
                "legal_entity": data.get("legal_entity"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            }

        except requests.RequestException as e:
            raise ValueError(f"Company API request failed: {str(e)}")


    # =========================================================
    # UPDATE COMPANY
    # =========================================================

    @classmethod
    def update_company(
        cls,
        company_id: str,
        name: str,
        industry: str,
        region: str,
        legal_entity: str,
        tenant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update company via PATCH API (expects full object).
        """

        if not company_id or not str(company_id).strip():
            raise ValueError("company_id is required.")

        payload = {
            "name": name,
            "industry": industry,
            "region": region,
            "legal_entity": legal_entity,
        }

        url = f"{COMPANY_API_BASE_URL}/{company_id}"

        try:
            response = requests.patch(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "accept": "application/json"
                },
                timeout=30
            )

            if response.status_code not in [200, 201]:
                raise ValueError(
                    f"Company update failed: {response.status_code} - {response.text}"
                )

            data = response.json()

            return {
                "message": "Company updated successfully.",
                "company_id": data.get("id"),
                "name": data.get("name"),
                "industry": data.get("industry"),
                "region": data.get("region"),
                "legal_entity": data.get("legal_entity"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            }

        except requests.RequestException as e:
            raise ValueError(f"Company API request failed: {str(e)}")

