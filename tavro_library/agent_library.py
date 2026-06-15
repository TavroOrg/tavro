import os
import re
import json
import math
import uuid
import requests
import threading
from pathlib import Path
from datetime import datetime
from rapidfuzz import process, fuzz
from typing import Dict, Any, List, Optional
from contextlib import contextmanager
from utils.db import DATABASE_URL, SyncSessionLocal
from services.db.db_functions import refresh_curated_agent_360, create_local_agent_card
from dotenv import load_dotenv

load_dotenv(override=False)

COMPANY_API_BASE_URL = os.getenv("COMPANY_API_BASE_URL")
class AgentMetadataExporter:
    CORE_DB_NAME=os.getenv("CORE_DB_NAME")
    CURATED_DB_NAME=os.getenv("CURATED_DB_NAME")
    RISK_MANAGEMENT_DB_NAME=os.getenv("RISK_MANAGEMENT_DB_NAME")

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

                # Overlay linked issues from DB so issue tab/card views reflect
                # records created through the Agent Details UI.
                try:
                    issue_params: list[Any] = [agent_id_clean]
                    issue_tenant_where = ""
                    if tenant_mode == "TENANT":
                        issue_tenant_where = """
                        AND (
                            rel.tenant_id = %s
                            OR rel.tenant_id IS NULL
                            OR rel.tenant_id = ''
                            OR rel.tenant_id = 'None'
                        )
                        """
                        issue_params.append(tenant_id)

                    issue_rows = cls.execute_select(
                        f"""
                        SELECT DISTINCT ON (rel.issue_id)
                            rel.issue_id AS identifier,
                            COALESCE(i.title, rel.title, rel.issue_id) AS title,
                            i.description,
                            i.issue_type,
                            i.severity,
                            i.source,
                            i.detected_at,
                            i.resolved_at,
                            i.status,
                            i.resolution_notes,
                            i.assignee,
                            i.owner,
                            COALESCE(i.updated_ts, rel.updated_ts) AS updated_ts,
                            COALESCE(i.created_ts, rel.created_ts) AS created_ts
                        FROM {cls.CORE_DB_NAME}.agent_issues rel
                        LEFT JOIN {cls.CORE_DB_NAME}.issues i
                          ON i.issue_id = rel.issue_id
                         AND COALESCE(i.tenant_id, '') = COALESCE(rel.tenant_id, '')
                        WHERE rel.agent_id = %s
                          {issue_tenant_where}
                          AND rel.issue_id IS NOT NULL
                          AND rel.issue_id <> ''
                        ORDER BY rel.issue_id, COALESCE(i.updated_ts, rel.updated_ts) DESC NULLS LAST
                        """,
                        tuple(issue_params),
                    )
                    local_card["issues"] = [
                        {
                            "identifier": r.get("identifier"),
                            "title": r.get("title"),
                            "description": r.get("description"),
                            "issue_type": r.get("issue_type"),
                            "severity": r.get("severity"),
                            "source": r.get("source"),
                            "detected_at": str(r.get("detected_at")) if r.get("detected_at") else None,
                            "resolved_at": str(r.get("resolved_at")) if r.get("resolved_at") else None,
                            "status": r.get("status"),
                            "resolution_notes": r.get("resolution_notes"),
                            "assignee": r.get("assignee"),
                            "owner": r.get("owner"),
                            "created_ts": str(r.get("created_ts")) if r.get("created_ts") else None,
                            "updated_ts": str(r.get("updated_ts")) if r.get("updated_ts") else None,
                        }
                        for r in issue_rows
                        if r.get("identifier")
                    ]
                except Exception as issue_overlay_err:
                    print(f"[get_agent_card] Issues overlay failed: {issue_overlay_err}")

                # Overlay data_source from DB so renames and new relationships are
                # immediately visible in the UI lineage without regenerating the card file.
                try:
                    ds_rows = cls.execute_select(
                        f"""
                        SELECT relationship_id, parent_relationship_id,
                               source_object_id, source_object_domain, source_object_name, source_object_type,
                               target_object_id, target_object_domain, target_object_name, target_object_type,
                               access_level, contains_pii, contains_phi, contains_pci
                        FROM {cls.CORE_DB_NAME}.agent_data_sources
                        WHERE agent_id = %s
                        ORDER BY created_ts NULLS LAST
                        """,
                        (agent_id_clean,),
                    )
                    if ds_rows:
                        local_card["data_source"] = [
                            {
                                "relationship_id": r.get("relationship_id"),
                                "parent_relationship_id": r.get("parent_relationship_id"),
                                "source_object_id": r.get("source_object_id"),
                                "source_object_domain": r.get("source_object_domain"),
                                "source_object_name": r.get("source_object_name"),
                                "source_object_type": r.get("source_object_type"),
                                "target_object_id": r.get("target_object_id"),
                                "target_object_domain": r.get("target_object_domain"),
                                "target_object_name": r.get("target_object_name"),
                                "target_object_type": r.get("target_object_type"),
                                "access_level": r.get("access_level"),
                                "uses_pii": r.get("contains_pii"),
                                "uses_phi": r.get("contains_phi"),
                                "uses_pci": r.get("contains_pci"),
                            }
                            for r in ds_rows
                        ]
                except Exception as ds_overlay_err:
                    print(f"[get_agent_card] Data source overlay failed (returning card as-is): {ds_overlay_err}")

                # Overlay tool list from DB so tools added via update_agent are visible.
                try:
                    tool_rows = cls.execute_select(
                        f"""
                        SELECT at.tool_id, t.tool_name, t.tool_description,
                               t.delegation_possible, t.allowed_delegates,
                               t.input_schema_json_text, t.output_schema_json_text,
                               t.default_config_json_text
                        FROM {cls.CORE_DB_NAME}.agent_tools at
                        JOIN {cls.CORE_DB_NAME}.tools t ON t.tool_id = at.tool_id
                        WHERE at.agent_id = %s
                        ORDER BY at.created_ts NULLS LAST
                        """,
                        (agent_id_clean,),
                    )
                    if tool_rows:
                        local_card["tool"] = [
                            {
                                "identifier": r.get("tool_id"),
                                "name": r.get("tool_name"),
                                "description": r.get("tool_description"),
                                "delegation_possible": r.get("delegation_possible"),
                                "allowed_delegates": r.get("allowed_delegates"),
                                "parameter_name": None,
                                "parameter_type": None,
                                "default_value": r.get("default_config_json_text"),
                                "input_schema": r.get("input_schema_json_text"),
                                "output_schema": r.get("output_schema_json_text"),
                            }
                            for r in tool_rows
                        ]
                except Exception as tool_overlay_err:
                    print(f"[get_agent_card] Tool overlay failed (returning card as-is): {tool_overlay_err}")

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
        primary_url = os.getenv("RISK_CLASSIFY_URL")
        fallback_url = os.getenv("RISK_CLASSIFY_FALLBACK_URL")

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
    def _clean_text(value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        text_value = str(value).strip()
        return text_value or None

    @classmethod
    def _column_names(cls, raw_columns: Any) -> List[str]:
        if not raw_columns:
            return []
        if isinstance(raw_columns, str):
            raw_columns = [raw_columns]
        if not isinstance(raw_columns, list):
            return []

        names: List[str] = []
        seen = set()
        for col in raw_columns:
            if isinstance(col, dict):
                name = cls._clean_text(col.get("name") or col.get("column_name") or col.get("identifier"))
            else:
                name = cls._clean_text(col)
            if name and name.lower() not in seen:
                seen.add(name.lower())
                names.append(name)
        return names

    @classmethod
    def _table_items(cls, raw_tables: Any) -> List[Dict[str, Any]]:
        if not raw_tables:
            return []
        if isinstance(raw_tables, dict):
            raw_tables = [raw_tables]
        elif isinstance(raw_tables, str):
            raw_tables = [{"name": raw_tables}]
        if not isinstance(raw_tables, list):
            return []

        tables: List[Dict[str, Any]] = []
        for raw in raw_tables:
            if isinstance(raw, str):
                raw = {"name": raw}
            if not isinstance(raw, dict):
                continue
            tables.append({
                "table_id": cls._clean_text(raw.get("table_id") or raw.get("id") or raw.get("identifier")),
                "name": cls._clean_text(raw.get("name") or raw.get("table_name")),
                "tool_name": cls._clean_text(raw.get("tool_name") or raw.get("tool")),
                "tool_id": cls._clean_text(raw.get("tool_id")),
            })
        return tables

    @classmethod
    def _column_items(cls, raw_columns: Any) -> List[Dict[str, Any]]:
        if not raw_columns:
            return []
        if isinstance(raw_columns, dict):
            raw_columns = [raw_columns]
        elif isinstance(raw_columns, str):
            raw_columns = [{"name": raw_columns}]
        if not isinstance(raw_columns, list):
            return []

        columns: List[Dict[str, Any]] = []
        seen = set()
        for raw in raw_columns:
            if isinstance(raw, str):
                raw = {"name": raw}
            if not isinstance(raw, dict):
                continue
            name = cls._clean_text(raw.get("name") or raw.get("column_name") or raw.get("identifier"))
            if not name:
                continue
            table_id = cls._clean_text(raw.get("table_id"))
            table_name = cls._clean_text(raw.get("table_name") or raw.get("table"))
            key = (name.lower(), (table_id or "").lower(), (table_name or "").lower())
            if key in seen:
                continue
            seen.add(key)
            columns.append({
                "name": name,
                "table_id": table_id,
                "table_name": table_name,
            })
        return columns

    @classmethod
    def _tables_from_tools(cls, tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        tables: List[Dict[str, Any]] = []
        for tool in tools or []:
            if not isinstance(tool, dict):
                continue
            tool_name = cls._clean_text(tool.get("name"))
            tool_tables = cls._table_items(tool.get("tables") or tool.get("table"))

            for table in tool_tables:
                table["tool_name"] = table.get("tool_name") or tool_name
                tables.append(table)
        return tables

    @classmethod
    def _tables_from_data_sources(cls, data_sources: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        table_map: Dict[str, Dict[str, Any]] = {}
        for entry in data_sources or []:
            if not isinstance(entry, dict):
                continue
            src_type = str(entry.get("source_object_type") or "").lower()
            tgt_type = str(entry.get("target_object_type") or "").lower()
            if src_type == "table" and tgt_type == "column":
                table_id = cls._clean_text(entry.get("source_object_id"))
                if not table_id:
                    continue
                item = table_map.setdefault(
                    table_id,
                    {"table_id": table_id, "name": cls._clean_text(entry.get("source_object_name")), "tool_name": None, "tool_id": None},
                )
            elif src_type == "agent" and tgt_type == "table":
                table_id = cls._clean_text(entry.get("target_object_id"))
                if not table_id:
                    continue
                item = table_map.setdefault(
                    table_id,
                    {"table_id": table_id, "name": cls._clean_text(entry.get("target_object_name")), "tool_name": None, "tool_id": None},
                )
                item["name"] = item.get("name") or cls._clean_text(entry.get("target_object_name"))
            elif src_type == "tool" and tgt_type == "table":
                table_id = cls._clean_text(entry.get("target_object_id"))
                if not table_id:
                    continue
                item = table_map.setdefault(
                    table_id,
                    {"table_id": table_id, "name": cls._clean_text(entry.get("target_object_name")), "tool_name": None, "tool_id": None},
                )
                item["tool_id"] = cls._clean_text(entry.get("source_object_id"))
                item["tool_name"] = cls._clean_text(entry.get("source_object_name"))
                item["name"] = item.get("name") or cls._clean_text(entry.get("target_object_name"))
        return list(table_map.values())

    @classmethod
    def _columns_from_data_sources(cls, data_sources: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        columns: List[Dict[str, Any]] = []
        for entry in data_sources or []:
            if not isinstance(entry, dict):
                continue
            src_type = str(entry.get("source_object_type") or "").lower()
            tgt_type = str(entry.get("target_object_type") or "").lower()
            if src_type != "table" or tgt_type != "column":
                continue
            column_name = cls._clean_text(entry.get("target_object_name") or entry.get("target_object_id"))
            if not column_name:
                continue
            columns.append({
                "name": column_name,
                "table_id": cls._clean_text(entry.get("source_object_id")),
                "table_name": cls._clean_text(entry.get("source_object_name")),
            })
        return columns

    @classmethod
    def _normalize_tables_payload(
        cls,
        tables: Any,
        tools: Optional[List[Dict[str, Any]]],
        data_sources: Optional[List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        normalized: Dict[str, Dict[str, Any]] = {}
        for table in [
            *cls._table_items(tables),
            *cls._tables_from_tools(tools),
            *cls._tables_from_data_sources(data_sources),
        ]:
            raw_table_id = table.get("table_id")
            table_name = table.get("name")
            if raw_table_id:
                key = f"id:{raw_table_id}"
            elif table_name:
                key = f"name:{str(table_name).strip().lower()}"
            else:
                key = f"anonymous:{len(normalized)}"
            item = normalized.setdefault(
                key,
                {
                    "table_id": raw_table_id,
                    "source_table_id": raw_table_id,
                    "name": table_name,
                    "tool_name": table.get("tool_name"),
                    "tool_id": table.get("tool_id"),
                },
            )
            item["table_id"] = item.get("table_id") or raw_table_id
            item["source_table_id"] = item.get("source_table_id") or raw_table_id
            item["name"] = table_name or item.get("name")
            item["tool_name"] = table.get("tool_name") or item.get("tool_name")
            item["tool_id"] = table.get("tool_id") or item.get("tool_id")

        for item in normalized.values():
            item["table_id"] = str(uuid.uuid4())
        return list(normalized.values())

    @classmethod
    def _columns_by_table(
        cls,
        tables_payload: List[Dict[str, Any]],
        columns: Any,
        data_sources: Optional[List[Dict[str, Any]]],
    ) -> Dict[int, List[str]]:
        column_entries = [
            *cls._column_items(columns),
            *cls._columns_from_data_sources(data_sources),
        ]
        columns_by_table: Dict[int, List[str]] = {}

        for col_entry in column_entries:
            col_name = cls._clean_text(col_entry.get("name"))
            if not col_name:
                continue
            match_id = str(col_entry.get("table_id") or "").strip()
            match_name = str(col_entry.get("table_name") or "").strip().lower()

            matched_index: Optional[int] = None
            for index, tbl in enumerate(tables_payload):
                table_ids = {
                    str(tbl.get("table_id") or "").strip(),
                    str(tbl.get("source_table_id") or "").strip(),
                }
                table_name = str(tbl.get("name") or "").strip().lower()
                if (match_id and match_id in table_ids) or (match_name and table_name == match_name):
                    matched_index = index
                    break

            if matched_index is None and len(tables_payload) == 1 and not match_id and not match_name:
                matched_index = 0
            if matched_index is None:
                continue

            existing = {name.strip().lower() for name in columns_by_table.get(matched_index, [])}
            col_key = col_name.strip().lower()
            if col_key not in existing:
                columns_by_table.setdefault(matched_index, []).append(col_name)

        return columns_by_table

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
        tools: Optional[List[Dict[str, Any]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        tool_ids: Optional[List[str]] = None,
        issues: Optional[List[Dict]] = None,
        tables: Optional[List[Dict[str, Any]]] = None,
        columns_by_table: Optional[Dict[int, List[str]]] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
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
                    data_source_entries.append({
                        "relationship_id": None,
                        "parent_relationship_id": None,
                        "source_object_id": agent_id,
                        "source_object_domain": None,
                        "source_object_name": agent_name,
                        "source_object_type": "Agent",
                        "target_object_id": tool_id,
                        "target_object_domain": None,
                        "target_object_name": tool.get("name"),
                        "target_object_type": "Tool",
                        "access_level": None,
                        "uses_pii": None,
                        "uses_phi": None,
                        "uses_pci": None,
                    })

            for table_index, table in enumerate(tables or []):
                table_id = table.get("table_id")
                table_name = table.get("name")
                if not table_id:
                    continue
                data_source_entries.append({
                    "relationship_id": None,
                    "parent_relationship_id": None,
                    "source_object_id": table.get("tool_id") or agent_id,
                    "source_object_domain": None,
                    "source_object_name": table.get("tool_name") or agent_name,
                    "source_object_type": "Tool" if table.get("tool_id") else "Agent",
                    "target_object_id": table_id,
                    "target_object_domain": None,
                    "target_object_name": table_name,
                    "target_object_type": "Table",
                    "access_level": None,
                    "uses_pii": None,
                    "uses_phi": None,
                    "uses_pci": None,
                })
                for column_name in (columns_by_table or {}).get(table_index, []):
                    col_id = str(uuid.uuid4())
                    data_source_entries.append({
                        "relationship_id": None,
                        "parent_relationship_id": None,
                        "source_object_id": table_id,
                        "source_object_domain": None,
                        "source_object_name": table_name,
                        "source_object_type": "Table",
                        "target_object_id": col_id,
                        "target_object_domain": None,
                        "target_object_name": column_name,
                        "target_object_type": "Column",
                        "access_level": None,
                        "uses_pii": None,
                        "uses_phi": None,
                        "uses_pci": None,
                    })

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
                "issues": issues or [],
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
                "issues": [
                    {
                        "identifier": iss.get("identifier"),
                        "title": iss.get("title"),
                        "description": iss.get("description"),
                        "issue_type": iss.get("issue_type"),
                        "severity": iss.get("severity"),
                        "source": iss.get("source"),
                        "detected_at": str(iss.get("detected_at")) if iss.get("detected_at") else None,
                        "resolved_at": str(iss.get("resolved_at")) if iss.get("resolved_at") else None,
                        "status": iss.get("status"),
                        "resolution_notes": iss.get("resolution_notes"),
                        "assignee": iss.get("assignee"),
                        "owner": iss.get("owner"),
                        "created_ts": None,
                        "updated_ts": None,
                    }
                    for iss in (issues or [])
                    if str(iss.get("title", "")).strip()
                ],
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
        tools: Optional[List[Dict[str, Any]]] = None,
        tables: Optional[List[Dict[str, Any]]] = None,
        columns: Optional[List[Dict[str, Any]]] = None,
        data_source: Optional[List[Dict[str, Any]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
        tenant_id: Optional[str] = None,
        company_id: Optional[str] = None,
        company_name: Optional[str] = None,
        issues: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        Create a new agent.

        ``data_source`` accepts a list of table/column definitions that describe
        the Agent -> Table -> Column data-source hierarchy. Each entry supports:

            {
              "table_name": str,
              "table_domain": str | None,
              "access_level": str | None,
              "columns": [
                  {
                    "column_name": str,
                    "column_domain": str | None,
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
        company_id = cls.sanitize(str(company_id).strip()) if company_id else None
        company_name = cls.sanitize(str(company_name).strip()) if company_name else None

        agent_id = str(uuid.uuid4())
        agent_internal_id = str(uuid.uuid4())
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        queries = []
        data_source_values = []
        table_values = []
        column_values = []
        agent_table_values = []
        tool_table_values = []
        table_column_values = []
        tool_ids_for_card: List[str] = []
        tool_name_to_id: Dict[str, str] = {}
        tables_payload = cls._normalize_tables_payload(tables, tools, data_source)
        columns_by_table = cls._columns_by_table(tables_payload, columns, data_source)

        # 1. agents table
        tenant_id_value = f"'{tenant_id}'," if tenant_id else ""
        tenant_id_column = "tenant_id," if tenant_id else ""
        company_id_value = f"'{company_id}'," if company_id else "NULL,"
        company_name_value = f"'{company_name}'," if company_name else "NULL,"
        queries.append(f"""
        INSERT INTO {cls.CORE_DB_NAME}.agents (
            {tenant_id_column}
            agent_internal_id,
            agent_id,
            agent_name,
            agent_description,
            company_id,
            company_name,
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
            {company_id_value}
            {company_name_value}
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

        # 3. tools — insert master data into core.tools, relation into core.agent_tools
        if tools:
            tools_master_values = []
            relation_values = []
            for tool in tools:
                tool_id = str(uuid.uuid4())
                tool_ids_for_card.append(tool_id)
                name = cls.sanitize(tool.get("name"))
                desc = cls.sanitize(tool.get("description"))
                if name:
                    tool_name_to_id[str(tool.get("name")).strip().lower()] = tool_id

                tools_master_values.append(f"""
                (
                    {tenant_id_value}
                    '{tool_id}',
                    '{name}',
                    '{desc}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                """)
                relation_values.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{tool_id}',
                    '{agent_id}',
                    '{name}',
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

            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.tools (
                {tenant_id_column}
                tool_id,
                tool_name,
                tool_description,
                created_ts,
                updated_ts
            )
            VALUES
            {",".join(tools_master_values)}
            ON CONFLICT (tool_id) DO UPDATE SET
                tool_name        = EXCLUDED.tool_name,
                tool_description = EXCLUDED.tool_description,
                updated_ts       = EXCLUDED.updated_ts
            """)
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_tools (
                {tenant_id_column}
                agent_internal_id,
                tool_id,
                agent_id,
                tool_name,
                created_ts,
                updated_ts
            )
            VALUES
            {",".join(relation_values)}
            ON CONFLICT (agent_internal_id, tool_id) DO UPDATE SET
                agent_id   = EXCLUDED.agent_id,
                tool_name  = EXCLUDED.tool_name,
                updated_ts = EXCLUDED.updated_ts
            """)

        for table_index, table in enumerate(tables_payload):
            tool_name_key = str(table.get("tool_name") or "").strip().lower()
            if tool_name_key and not table.get("tool_id"):
                table["tool_id"] = tool_name_to_id.get(tool_name_key)

            table_id = str(uuid.uuid4())
            table["table_id"] = table_id
            table_name = cls.sanitize(table.get("name") or "")
            table_tool_id = cls.sanitize(table.get("tool_id") or "")
            table_tool_name = cls.sanitize(table.get("tool_name") or "")

            table_values.append(f"""
            (
                {tenant_id_value}
                '{table_id}',
                '{table_name}',
                TIMESTAMP '{now}',
                TIMESTAMP '{now}'
            )
            """)

        # 3.5 issues — insert into core.issues + core.agent_issues
            # agent_tables relationship
            agent_table_values.append(f"""
            (
                {tenant_id_value}
                '{agent_id}',
                '{agent_name}',
                '{agent_internal_id}',
                '{table_id}',
                '{table_name}',
                TIMESTAMP '{now}',
                TIMESTAMP '{now}'
            )
            """)

            if table_tool_id:
                data_source_values.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{agent_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}',
                    '{table_tool_id}',
                    '{table_tool_name}',
                    'Tool',
                    '{table_id}',
                    '{table_name}',
                    'Table'
                )
                """)
                # tool_tables relationship
                tool_table_values.append(f"""
                (
                    {tenant_id_value}
                    '{table_tool_id}',
                    '{table_tool_name}',
                    '{table_id}',
                    '{table_name}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                """)
            else:
                data_source_values.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{agent_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}',
                    '{agent_id}',
                    '{agent_name}',
                    'Agent',
                    '{table_id}',
                    '{table_name}',
                    'Table'
                )
                """)

            for column_name in columns_by_table.get(table_index, []):
                clean_column = cls.sanitize(column_name)
                if not clean_column:
                    continue
                column_id = str(uuid.uuid4())
                column_values.append(f"""
                (
                    '{column_id}',
                    {tenant_id_value}
                    '{clean_column}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                """)
                # table_columns relationship
                table_column_values.append(f"""
                (
                    {tenant_id_value}
                    '{table_id}',
                    '{table_name}',
                    '{clean_column}',
                    '{column_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}'
                )
                """)
                data_source_values.append(f"""
                (
                    {tenant_id_value}
                    '{agent_internal_id}',
                    '{agent_id}',
                    TIMESTAMP '{now}',
                    TIMESTAMP '{now}',
                    '{table_id}',
                    '{table_name}',
                    'Table',
                    '{column_id}',
                    '{clean_column}',
                    'Column'
                )
                """)

        issue_entries_for_card: List[Dict] = []
        if issues:
            issue_rows_i: List[str] = []
            issue_rows_ai: List[str] = []
            for issue in issues:
                title_raw = str(issue.get("title", "")).strip()
                if not title_raw:
                    continue
                identifier = str(uuid.uuid4())
                i_title           = cls.sanitize(title_raw)
                i_description     = f"'{cls.sanitize(str(issue['description']))}'" if issue.get("description") else "NULL"
                i_issue_type      = f"'{cls.sanitize(str(issue['issue_type']))}'" if issue.get("issue_type") else "NULL"
                i_severity        = f"'{cls.sanitize(str(issue['severity']))}'" if issue.get("severity") else "NULL"
                i_source          = f"'{cls.sanitize(str(issue['source']))}'" if issue.get("source") else "NULL"
                i_detected_at     = f"TIMESTAMP '{cls.sanitize(str(issue['detected_at']))}'" if issue.get("detected_at") else "NULL"
                i_resolved_at     = f"TIMESTAMP '{cls.sanitize(str(issue['resolved_at']))}'" if issue.get("resolved_at") else "NULL"
                i_status          = f"'{cls.sanitize(str(issue['status']))}'" if issue.get("status") else "NULL"
                i_resolution_notes = f"'{cls.sanitize(str(issue['resolution_notes']))}'" if issue.get("resolution_notes") else "NULL"
                i_assignee        = f"'{cls.sanitize(str(issue['assignee']))}'" if issue.get("assignee") else "NULL"
                i_owner           = f"'{cls.sanitize(str(issue['owner']))}'" if issue.get("owner") else "NULL"
                issue_rows_i.append(
                    f"({tenant_id_value}'{identifier}', '{i_title}', "
                    f"{i_description}, {i_issue_type}, {i_severity}, "
                    f"{i_source}, {i_detected_at}, {i_resolved_at}, "
                    f"{i_status}, {i_resolution_notes}, "
                    f"{i_assignee}, {i_owner}, "
                    f"TIMESTAMP '{now}', TIMESTAMP '{now}')"
                )
                issue_rows_ai.append(
                    f"({tenant_id_value}'{identifier}', '{i_title}', "
                    f"'{agent_id}', '{agent_name}', "
                    f"'{agent_internal_id}', "
                    f"TIMESTAMP '{now}', TIMESTAMP '{now}')"
                )
                issue_entries_for_card.append({
                    "identifier": identifier,
                    "title": title_raw,
                    "description": issue.get("description"),
                    "issue_type": issue.get("issue_type"),
                    "severity": issue.get("severity"),
                    "source": issue.get("source"),
                    "detected_at": issue.get("detected_at"),
                    "resolved_at": issue.get("resolved_at"),
                    "status": issue.get("status"),
                    "resolution_notes": issue.get("resolution_notes"),
                    "assignee": issue.get("assignee"),
                    "owner": issue.get("owner"),
                })
            if issue_rows_i:
                queries.append(f"""
                INSERT INTO {cls.CORE_DB_NAME}.issues (
                    {tenant_id_column}issue_id, title,
                    description, issue_type, severity,
                    source, detected_at, resolved_at,
                    status, resolution_notes,
                    assignee, owner,
                    created_ts, updated_ts
                )
                VALUES {','.join(issue_rows_i)}
                """)
                queries.append(f"""
                INSERT INTO {cls.CORE_DB_NAME}.agent_issues (
                    {tenant_id_column}issue_id, title,
                    agent_id, agent_name,
                    agent_internal_id,
                    created_ts, updated_ts
                )
                VALUES {','.join(issue_rows_ai)}
                """)

        # 4. table and column inserts

        if table_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.tables (
                {tenant_id_column}
                table_id,
                name,
                created_ts,
                updated_ts
            )
            VALUES
            {",".join(table_values)}
            """)

        if column_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.columns (
                column_id,
                {tenant_id_column}
                name,
                created_ts,
                updated_ts
            )
            VALUES
            {",".join(column_values)}
            """)

        if agent_table_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_tables (
                {tenant_id_column}
                agent_id, agent_name, agent_internal_id,
                table_id, table_name, created_ts, updated_ts
            )
            VALUES
            {",".join(agent_table_values)}
            """)

        if tool_table_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.tool_tables (
                {tenant_id_column}
                tool_id, tool_name, table_id, table_name,
                created_ts, updated_ts
            )
            VALUES
            {",".join(tool_table_values)}
            """)

        if table_column_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.table_columns (
                {tenant_id_column}
                table_id, table_name, column_name, column_id, created_ts, updated_ts
            )
            VALUES
            {",".join(table_column_values)}
            """)

        # 5. knowledge sources (ONLY name + description)
        if knowledge_source:
            ks_name = cls.sanitize(knowledge_source.get("name"))
            ks_desc = cls.sanitize(knowledge_source.get("description"))
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_knowledge_sources (
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
        # 5. data source insert
        if data_source_values:
            queries.append(f"""
            INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources (
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
            issues=issue_entries_for_card,
            tables=tables_payload,
            columns_by_table=columns_by_table,
            skills=skills,
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
            updated_ts
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
            TIMESTAMP '{now}'
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
        tools: Optional[List[Dict[str, Any]]] = None,
        knowledge_source: Optional[Dict[str, str]] = None,
        tables: Optional[List[Dict[str, Any]]] = None,
        columns: Optional[List[Dict[str, Any]]] = None,
        data_source: Optional[List[Dict[str, Any]]] = None,
        skills: Optional[List[Any]] = None,
        tenant_id: Optional[str] = None,
        issues: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Update existing agent with minimal query overhead.
        Only provided fields are updated.
        """
        if not agent_id and not agent_name:
            raise ValueError("Either agent_id or agent_name is required.")

        # Setup tenant context
        is_tenant = tenant_id and str(tenant_id).strip().lower() not in ["none", "null", ""]
        tenant_clean = cls.sanitize(tenant_id) if is_tenant else None
        tenant_where = f"AND tenant_id = '{tenant_clean}'" if is_tenant else ""
        tenant_col = "tenant_id," if is_tenant else ""
        tenant_val = f"'{tenant_clean}'," if is_tenant else ""
        tenant_lit = f"'{tenant_clean}'" if is_tenant else "NULL"

        # Resolve agent ID (1 query)
        if not agent_id:
            agent_id = cls._get_agent_id_from_name(agent_name, tenant_id)
            if not agent_id:
                raise ValueError(f"Agent '{agent_name}' not found.")
        agent_id = cls.sanitize(str(agent_id).strip())

        # Fetch agent info (1 query)
        rows = cls.execute_select(f"SELECT agent_internal_id, agent_name FROM {cls.CORE_DB_NAME}.agents WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where} LIMIT 1")
        if not rows:
            raise ValueError(f"Agent '{agent_id}' not found.")

        agent_internal_id = rows[0].get("agent_internal_id")
        current_agent_name = cls.sanitize(str(rows[0].get("agent_name") or "").strip())
        effective_agent_name = current_agent_name
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Batch updates into single transaction
        if agent_name is not None and str(agent_name).strip():
            effective_agent_name = cls.sanitize(agent_name)
            cls.execute_dml(f"UPDATE {cls.CORE_DB_NAME}.agents SET agent_name = '{effective_agent_name}', updated_ts = TIMESTAMP '{now}' WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}")

        if description is not None and str(description).strip():
            cls.execute_dml(f"UPDATE {cls.CORE_DB_NAME}.agents SET agent_description = '{cls.sanitize(description)}', updated_ts = TIMESTAMP '{now}' WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}")

        if instruction:
            instr = cls.sanitize(instruction)
            cls.execute_dml(f"UPDATE {cls.CORE_DB_NAME}.agent_identifications SET is_current = false, updated_ts = TIMESTAMP '{now}' WHERE agent_id = '{agent_id}' AND is_current = true {tenant_where}")
            cls.execute_dml(f"INSERT INTO {cls.CORE_DB_NAME}.agent_identifications ({tenant_col}agent_internal_id, agent_id, instruction, created_ts, updated_ts, is_current) VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', '{instr}', TIMESTAMP '{now}', TIMESTAMP '{now}', true)")

        # None means "leave unchanged"; [] means "clear all tools"
        if tools is not None:
            # Capture existing tools (ordered by created_ts) and their Tool→Table lineage
            # before deleting, so we can re-link tables to renamed tools by position.
            existing_tools_rows = cls.execute_select(
                f"SELECT tool_id, tool_name FROM {cls.CORE_DB_NAME}.agent_tools "
                f"WHERE agent_id = '{agent_id}' {tenant_where} ORDER BY created_ts"
            )
            # Map old_tool_id → list of Tool→Table data_source rows
            tool_table_map: dict = {}
            for et in existing_tools_rows:
                et_id = cls.sanitize(str(et.get("tool_id") or ""))
                if not et_id:
                    continue
                tt_rows = cls.execute_select(
                    f"SELECT target_object_id, target_object_domain, target_object_name, target_object_type, "
                    f"access_level, contains_pii, contains_phi, contains_pci "
                    f"FROM {cls.CORE_DB_NAME}.agent_data_sources "
                    f"WHERE agent_internal_id = '{agent_internal_id}' "
                    f"AND source_object_id = '{et_id}' "
                    f"AND LOWER(source_object_type) = 'tool'"
                )
                tool_table_map[et_id] = tt_rows

            # Remove existing tool records, Agent→Tool entries, and Tool→Table entries
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_tools "
                f"WHERE agent_id = '{agent_id}' {tenant_where}"
            )
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_data_sources "
                f"WHERE agent_internal_id = '{agent_internal_id}' "
                f"AND target_object_type = 'Tool'"
            )
            cls.execute_dml(
                f"DELETE FROM {cls.CORE_DB_NAME}.agent_data_sources "
                f"WHERE agent_internal_id = '{agent_internal_id}' "
                f"AND LOWER(source_object_type) = 'tool'"
            )
            if tools:
                tool_rows: List[str] = []
                tool_master_rows: List[str] = []
                tool_ds_rows: List[str] = []
                new_tool_ids: List[tuple] = []  # (tool_id, tool_name)
                for t in tools:
                    tool_id = str(uuid.uuid4())
                    t_name = cls.sanitize(t.get("name", ""))
                    t_desc = cls.sanitize(t.get("description", ""))
                    new_tool_ids.append((tool_id, t_name))
                    tool_master_rows.append(
                        f"({tenant_val}'{tool_id}', '{t_name}', '{t_desc}', "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}')"
                    )
                    tool_rows.append(
                        f"({tenant_val}'{agent_internal_id}', '{tool_id}', '{agent_id}', "
                        f"'{cls.sanitize(effective_agent_name)}', '{t_name}', '{t_desc}', TIMESTAMP '{now}', TIMESTAMP '{now}')"
                    )
                    tool_ds_rows.append(
                        f"({tenant_val}'{agent_internal_id}', '{agent_id}', "
                        f"NULL, NULL::boolean, NULL::boolean, NULL::boolean, "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}', "
                        f"'{agent_id}', NULL, '{cls.sanitize(effective_agent_name)}', 'Agent', "
                        f"'{tool_id}', NULL, '{t_name}', 'Tool')"
                    )
                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.tools "
                    f"({tenant_col}tool_id, tool_name, tool_description, created_ts, updated_ts) "
                    f"VALUES {','.join(tool_master_rows)} "
                    f"ON CONFLICT (tool_id) DO UPDATE SET "
                    f"tool_name = EXCLUDED.tool_name, tool_description = EXCLUDED.tool_description, "
                    f"updated_ts = EXCLUDED.updated_ts"
                )
                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.agent_tools "
                    f"({tenant_col}agent_internal_id, tool_id, agent_id, agent_name, tool_name, tool_description, created_ts, updated_ts) "
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

                # Re-link Tool->Table entries using positional matching (old[i] -> new[i])
                relink_ds_rows: List[str] = []
                for i, (new_tool_id, new_tool_name) in enumerate(new_tool_ids):
                    if i >= len(existing_tools_rows):
                        break
                    old_tool_id = cls.sanitize(str(existing_tools_rows[i].get("tool_id") or ""))
                    for tt in tool_table_map.get(old_tool_id, []):
                        tgt_id = cls.sanitize(str(tt.get("target_object_id") or ""))
                        tgt_name = cls.sanitize(str(tt.get("target_object_name") or ""))
                        tgt_type = cls.sanitize(str(tt.get("target_object_type") or ""))
                        if not tgt_id:
                            continue
                        relink_ds_rows.append(
                            f"({tenant_val}'{agent_internal_id}', '{agent_id}', "
                            f"NULL, NULL::boolean, NULL::boolean, NULL::boolean, "
                            f"TIMESTAMP '{now}', TIMESTAMP '{now}', "
                            f"'{new_tool_id}', NULL, '{new_tool_name}', 'Tool', "
                            f"'{tgt_id}', NULL, '{tgt_name}', '{tgt_type}')"
                        )
                if relink_ds_rows:
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources "
                        f"({tenant_col}agent_internal_id, agent_id, "
                        f"access_level, contains_pii, contains_phi, contains_pci, "
                        f"created_ts, updated_ts, "
                        f"source_object_id, source_object_domain, source_object_name, source_object_type, "
                        f"target_object_id, target_object_domain, target_object_name, target_object_type) "
                        f"VALUES {','.join(relink_ds_rows)}"
                    )

        # Update issues — None means "leave unchanged"; [] means "clear all issues"
        if issues is not None:
            cls.execute_dml(
                f"WITH removed AS ("
                f"  DELETE FROM {cls.CORE_DB_NAME}.agent_issues "
                f"  WHERE agent_id = '{agent_id}' {tenant_where} "
                f"  RETURNING issue_id"
                f") "
                f"DELETE FROM {cls.CORE_DB_NAME}.issues i "
                f"WHERE i.issue_id IN (SELECT issue_id FROM removed) "
                f"{tenant_where.replace('tenant_id', 'i.tenant_id')} "
                f"AND NOT EXISTS ("
                f"  SELECT 1 FROM {cls.CORE_DB_NAME}.agent_issues rel "
                f"  WHERE rel.issue_id = i.issue_id "
                f"  {'AND rel.tenant_id = i.tenant_id' if is_tenant else ''}"
                f")"
            )
            if issues:
                u_issue_rows_i: List[str] = []
                u_issue_rows_ai: List[str] = []
                for issue in issues:
                    title_raw = str(issue.get("title", "")).strip()
                    if not title_raw:
                        continue
                    identifier = str(issue.get("identifier") or "").strip() or str(uuid.uuid4())
                    i_title           = cls.sanitize(title_raw)
                    i_description     = f"'{cls.sanitize(str(issue['description']))}'" if issue.get("description") else "NULL"
                    i_issue_type      = f"'{cls.sanitize(str(issue['issue_type']))}'" if issue.get("issue_type") else "NULL"
                    i_severity        = f"'{cls.sanitize(str(issue['severity']))}'" if issue.get("severity") else "NULL"
                    i_source          = f"'{cls.sanitize(str(issue['source']))}'" if issue.get("source") else "NULL"
                    i_detected_at     = f"TIMESTAMP '{cls.sanitize(str(issue['detected_at']))}'" if issue.get("detected_at") else "NULL"
                    i_resolved_at     = f"TIMESTAMP '{cls.sanitize(str(issue['resolved_at']))}'" if issue.get("resolved_at") else "NULL"
                    i_status          = f"'{cls.sanitize(str(issue['status']))}'" if issue.get("status") else "NULL"
                    i_resolution_notes = f"'{cls.sanitize(str(issue['resolution_notes']))}'" if issue.get("resolution_notes") else "NULL"
                    i_assignee        = f"'{cls.sanitize(str(issue['assignee']))}'" if issue.get("assignee") else "NULL"
                    i_owner           = f"'{cls.sanitize(str(issue['owner']))}'" if issue.get("owner") else "NULL"
                    u_issue_rows_i.append(
                        f"({tenant_val}'{identifier}', '{i_title}', "
                        f"{i_description}, {i_issue_type}, {i_severity}, "
                        f"{i_source}, {i_detected_at}, {i_resolved_at}, "
                        f"{i_status}, {i_resolution_notes}, "
                        f"{i_assignee}, {i_owner}, "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}')"
                    )
                    u_issue_rows_ai.append(
                        f"({tenant_val}'{identifier}', '{i_title}', "
                        f"'{agent_id}', '{cls.sanitize(effective_agent_name)}', "
                        f"'{agent_internal_id}', "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}')"
                    )
                if u_issue_rows_i:
                    issue_conflict = (
                        " ON CONFLICT (tenant_id, issue_id) DO UPDATE SET "
                        "title = EXCLUDED.title, "
                        "description = EXCLUDED.description, "
                        "issue_type = EXCLUDED.issue_type, "
                        "severity = EXCLUDED.severity, "
                        "source = EXCLUDED.source, "
                        "detected_at = EXCLUDED.detected_at, "
                        "resolved_at = EXCLUDED.resolved_at, "
                        "status = EXCLUDED.status, "
                        "resolution_notes = EXCLUDED.resolution_notes, "
                        "assignee = EXCLUDED.assignee, "
                        "owner = EXCLUDED.owner, "
                        "updated_ts = EXCLUDED.updated_ts"
                    ) if is_tenant else ""
                    agent_issue_conflict = (
                        " ON CONFLICT (tenant_id, issue_id, agent_id) DO UPDATE SET "
                        "title = EXCLUDED.title, "
                        "agent_name = EXCLUDED.agent_name, "
                        "agent_internal_id = EXCLUDED.agent_internal_id, "
                        "updated_ts = EXCLUDED.updated_ts"
                    ) if is_tenant else ""
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.issues "
                        f"({tenant_col}issue_id, title, "
                        f"description, issue_type, severity, "
                        f"source, detected_at, resolved_at, "
                        f"status, resolution_notes, "
                        f"assignee, owner, "
                        f"created_ts, updated_ts) "
                        f"VALUES {','.join(u_issue_rows_i)}"
                        f"{issue_conflict}"
                    )
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.agent_issues "
                        f"({tenant_col}issue_id, title, "
                        f"agent_id, agent_name, "
                        f"agent_internal_id, "
                        f"created_ts, updated_ts) "
                        f"VALUES {','.join(u_issue_rows_ai)}"
                        f"{agent_issue_conflict}"
                    )

        # Update knowledge source — when provided, replace existing
                # Re-link Tool→Table entries using positional matching (old[i] → new[i])
        if knowledge_source:
            cls.execute_dml(f"DELETE FROM {cls.CORE_DB_NAME}.agent_knowledge_sources WHERE agent_id = '{agent_id}' {tenant_where}")
            ks_name = cls.sanitize(knowledge_source.get("name", ""))
            ks_desc = cls.sanitize(knowledge_source.get("description", ""))
            cls.execute_dml(f"INSERT INTO {cls.CORE_DB_NAME}.agent_knowledge_sources ({tenant_col}agent_internal_id, agent_id, name, description, created_ts, updated_ts) VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', '{ks_name}', '{ks_desc}', TIMESTAMP '{now}', TIMESTAMP '{now}')")

        # Merge data_source entries into tables so both paths produce the same result
        if data_source:
            extra = cls._normalize_tables_payload(None, None, data_source)
            tables = list(tables or []) + extra
        tables_for_update = [table for table in (tables or []) if isinstance(table, dict)]
        columns_for_new_tables = [
            col for col in (columns or [])
            if isinstance(col, dict) and not col.get("old_name")
        ]
        columns_by_table = cls._columns_by_table(tables_for_update, columns_for_new_tables, data_source)

        tables_updated = 0
        for table_index, table in enumerate(tables_for_update):
            new_name = cls.sanitize(str(table.get("name") or "").strip())
            if not new_name:
                continue

            old_name = cls.sanitize(str(table.get("old_name") or "").strip())

            if old_name:
                # ── RENAME path ──────────────────────────────────────────────
                table_id = cls.sanitize(str(table.get("table_id") or "").strip())
                if not table_id:
                    found = cls.execute_select(
                        f"SELECT table_id FROM {cls.CORE_DB_NAME}.tables "
                        f"WHERE LOWER(name) = LOWER('{old_name}') {tenant_where} LIMIT 1"
                    )
                    if found:
                        table_id = cls.sanitize(str(found[0].get("table_id") or "").strip())
                if not table_id:
                    continue

                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.tables SET name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE table_id = '{table_id}'"
                )
                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.agent_tables SET table_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE table_id = '{table_id}' AND agent_id = '{agent_id}'"
                )
                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.tool_tables SET table_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE table_id = '{table_id}'"
                )
                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.table_columns SET table_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE table_id = '{table_id}'"
                )
                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.agent_data_sources "
                    f"SET target_object_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE agent_internal_id = '{agent_internal_id}' "
                    f"AND target_object_id = '{table_id}' "
                    f"AND LOWER(target_object_type) = 'table'"
                )
                cls.execute_dml(
                    f"UPDATE {cls.CORE_DB_NAME}.agent_data_sources "
                    f"SET source_object_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                    f"WHERE agent_internal_id = '{agent_internal_id}' "
                    f"AND source_object_id = '{table_id}' "
                    f"AND LOWER(source_object_type) = 'table'"
                )

            else:
                # ── INSERT path (new table) ───────────────────────────────────
                table_id = str(uuid.uuid4())

                tbl_tool_name = cls.sanitize(str(table.get("tool_name") or "").strip())
                tbl_tool_id = cls.sanitize(str(table.get("tool_id") or "").strip())
                if tbl_tool_name and not tbl_tool_id:
                    tool_rows = cls.execute_select(
                        f"SELECT tool_id FROM {cls.CORE_DB_NAME}.agent_tools "
                        f"WHERE agent_id = '{agent_id}' AND LOWER(tool_name) = LOWER('{tbl_tool_name}') {tenant_where} LIMIT 1"
                    )
                    if tool_rows:
                        tbl_tool_id = cls.sanitize(str(tool_rows[0].get("tool_id") or "").strip())

                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.tables ({tenant_col}table_id, name, created_ts, updated_ts) "
                    f"VALUES ({tenant_val}'{table_id}', '{new_name}', TIMESTAMP '{now}', TIMESTAMP '{now}') "
                    f"ON CONFLICT (table_id) DO UPDATE SET "
                    f"name = COALESCE(EXCLUDED.name, {cls.CORE_DB_NAME}.tables.name), updated_ts = EXCLUDED.updated_ts"
                )
                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.agent_tables "
                    f"({tenant_col}agent_id, agent_name, agent_internal_id, table_id, table_name, created_ts, updated_ts) "
                    f"VALUES ({tenant_val}'{agent_id}', '{current_agent_name}', '{agent_internal_id}', "
                    f"'{table_id}', '{new_name}', TIMESTAMP '{now}', TIMESTAMP '{now}') "
                    f"ON CONFLICT (tenant_id, agent_id, table_id) DO UPDATE SET "
                    f"table_name = COALESCE(EXCLUDED.table_name, {cls.CORE_DB_NAME}.agent_tables.table_name), "
                    f"updated_ts = EXCLUDED.updated_ts"
                )

                src_id = tbl_tool_id or agent_id
                src_name = tbl_tool_name or current_agent_name
                src_type = 'Tool' if tbl_tool_id else 'Agent'

                if tbl_tool_id:
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.tool_tables "
                        f"({tenant_col}tool_id, tool_name, table_id, table_name, created_ts, updated_ts) "
                        f"VALUES ({tenant_val}'{tbl_tool_id}', '{tbl_tool_name}', '{table_id}', '{new_name}', "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}') "
                        f"ON CONFLICT (tenant_id, tool_id, table_id) DO UPDATE SET "
                        f"table_name = COALESCE(EXCLUDED.table_name, {cls.CORE_DB_NAME}.tool_tables.table_name), "
                        f"updated_ts = EXCLUDED.updated_ts"
                    )

                cls.execute_dml(
                    f"INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources "
                    f"({tenant_col}agent_internal_id, agent_id, "
                    f"source_object_id, source_object_name, source_object_type, "
                    f"target_object_id, target_object_name, target_object_type, "
                    f"created_ts, updated_ts) "
                    f"VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', "
                    f"'{src_id}', '{src_name}', '{src_type}', "
                    f"'{table_id}', '{new_name}', 'Table', "
                    f"TIMESTAMP '{now}', TIMESTAMP '{now}') "
                    f"ON CONFLICT (agent_internal_id, source_object_id, target_object_id) DO UPDATE SET "
                    f"source_object_name = EXCLUDED.source_object_name, "
                    f"target_object_name = EXCLUDED.target_object_name, updated_ts = EXCLUDED.updated_ts"
                )

                for column_name in columns_by_table.get(table_index, []):
                    clean_col = cls.sanitize(str(column_name).strip())
                    if not clean_col:
                        continue
                    col_id = str(uuid.uuid4())

                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.columns ({tenant_col}column_id, name, created_ts, updated_ts) "
                        f"VALUES ({tenant_val}'{col_id}', '{clean_col}', TIMESTAMP '{now}', TIMESTAMP '{now}') "
                        f"ON CONFLICT (column_id) DO UPDATE SET updated_ts = EXCLUDED.updated_ts"
                    )
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.table_columns "
                        f"({tenant_col}table_id, table_name, column_name, column_id, created_ts, updated_ts) "
                        f"VALUES ({tenant_val}'{table_id}', '{new_name}', '{clean_col}', '{col_id}', "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}') "
                        f"ON CONFLICT (tenant_id, table_id, column_name) DO UPDATE SET "
                        f"column_id = COALESCE(EXCLUDED.column_id, {cls.CORE_DB_NAME}.table_columns.column_id), "
                        f"updated_ts = EXCLUDED.updated_ts"
                    )
                    cls.execute_dml(
                        f"INSERT INTO {cls.CORE_DB_NAME}.agent_data_sources "
                        f"({tenant_col}agent_internal_id, agent_id, "
                        f"source_object_id, source_object_name, source_object_type, "
                        f"target_object_id, target_object_name, target_object_type, "
                        f"created_ts, updated_ts) "
                        f"VALUES ({tenant_val}'{agent_internal_id}', '{agent_id}', "
                        f"'{table_id}', '{new_name}', 'Table', "
                        f"'{col_id}', '{clean_col}', 'Column', "
                        f"TIMESTAMP '{now}', TIMESTAMP '{now}') "
                        f"ON CONFLICT (agent_internal_id, source_object_id, target_object_id) DO UPDATE SET "
                        f"source_object_name = EXCLUDED.source_object_name, "
                        f"target_object_name = EXCLUDED.target_object_name, updated_ts = EXCLUDED.updated_ts"
                    )

            tables_updated += 1

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

        columns_updated = 0
        for col in (columns or []):
            if not isinstance(col, dict):
                continue
            new_name = cls.sanitize(str(col.get("name") or "").strip())
            old_name = cls.sanitize(str(col.get("old_name") or "").strip())
            if not new_name or not old_name:
                continue

            scoped_table_id = cls.sanitize(str(col.get("table_id") or "").strip())
            table_filter = f"AND table_id = '{scoped_table_id}'" if scoped_table_id else ""
            tenant_filter = f"AND tenant_id = '{tenant_clean}'" if is_tenant else ""

            found = cls.execute_select(
                f"SELECT column_id FROM {cls.CORE_DB_NAME}.table_columns "
                f"WHERE LOWER(column_name) = LOWER('{old_name}') {table_filter} {tenant_filter} LIMIT 1"
            )
            if not found:
                continue
            column_id = cls.sanitize(str(found[0].get("column_id") or "").strip())
            if not column_id:
                continue

            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.columns SET name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                f"WHERE column_id = '{column_id}'"
            )
            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.table_columns SET column_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                f"WHERE column_id = '{column_id}'"
            )
            cls.execute_dml(
                f"UPDATE {cls.CORE_DB_NAME}.agent_data_sources "
                f"SET target_object_name = '{new_name}', updated_ts = TIMESTAMP '{now}' "
                f"WHERE agent_internal_id = '{agent_internal_id}' "
                f"AND LOWER(target_object_type) = 'column' "
                f"AND LOWER(target_object_name) = LOWER('{old_name}')"
            )
            columns_updated += 1

        # Refresh curated snapshot and local card so downstream reads reflect changes immediately
        try:
            from services.db.db_functions import refresh_curated_agent_360, create_local_agent_card

            refresh_curated_agent_360(agent_internal_id, agent_id, tenant_id)
            create_local_agent_card(agent_internal_id)
            print(f"[update_agent] Refreshed agent_360 and local card for agent_id={agent_id}")
        except Exception as refresh_err:
            # Non-fatal: the update is committed; only the cached views are stale.
            print(f"[update_agent] Warning: post-update refresh failed (changes are saved): {refresh_err}")

        msg = "Agent updated successfully."
        if tables_updated:
            msg += f" {tables_updated} table(s) renamed."
        if columns_updated:
            msg += f" {columns_updated} column(s) renamed."
        return {"message": msg, "agent_id": agent_id}

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
        for table in ("agent_tools", "agent_knowledge_sources", "agent_data_sources", "agent_identifications", "agent_issues"):
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

    # =========================================================
    # PDF GENERATION
    # =========================================================

    _UNICODE_REPLACEMENTS: Dict[str, str] = {
        "—": "--",
        "–": "-",
        "‒": "-",
        "―": "--",
        "'": "'",
        "'": "'",
        "“": '"',
        "”": '"',
        "…": "...",
        " ": " ",
        "•": "-",
        "‣": "-",
        "●": "-",
        "→": "->",
        "←": "<-",
        "×": "x",
        "®": "(R)",
        "©": "(C)",
        "™": "(TM)",
        "‐": "-",
        "‑": "-",
    }

    @staticmethod
    def _markdown_to_pdf(markdown_content: str) -> bytes:
        """Convert a markdown string to a PDF byte string using fpdf2."""
        for char, replacement in AgentMetadataExporter._UNICODE_REPLACEMENTS.items():
            markdown_content = markdown_content.replace(char, replacement)
        markdown_content = markdown_content.encode("latin-1", errors="replace").decode("latin-1")

        from fpdf import FPDF

        class _PDF(FPDF):
            def header(self):
                pass

            def footer(self):
                self.set_y(-12)
                self.set_font("Helvetica", "I", 8)
                self.set_text_color(150, 150, 150)
                self.cell(0, 8, f"Page {self.page_no()}", align="C")

        pdf = _PDF()
        pdf.set_margins(20, 20, 20)
        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=18)

        def _to_latin1(text: str) -> str:
            for char, replacement in AgentMetadataExporter._UNICODE_REPLACEMENTS.items():
                text = text.replace(char, replacement)
            return text.encode("latin-1", errors="replace").decode("latin-1")

        def _strip_inline(text: str) -> str:
            text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
            text = re.sub(r"\*(.+?)\*", r"\1", text)
            text = re.sub(r"`(.+?)`", r"\1", text)
            text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
            return _to_latin1(text.strip())

        def _is_table_sep(line: str) -> bool:
            s = line.strip()
            return bool(s) and all(c in "|:- " for c in s)

        lines = markdown_content.split("\n")
        i = 0
        while i < len(lines):
            raw = lines[i]
            stripped = raw.strip()

            if stripped.startswith("# "):
                pdf.set_font("Helvetica", "B", 18)
                pdf.set_text_color(30, 30, 30)
                pdf.multi_cell(0, 10, _strip_inline(stripped[2:]))
                pdf.ln(3)

            elif stripped.startswith("## "):
                pdf.set_font("Helvetica", "B", 14)
                pdf.set_text_color(40, 40, 40)
                pdf.ln(3)
                pdf.multi_cell(0, 8, _strip_inline(stripped[3:]))
                pdf.ln(1)

            elif stripped.startswith("### "):
                pdf.set_font("Helvetica", "B", 12)
                pdf.set_text_color(50, 50, 50)
                pdf.ln(2)
                pdf.multi_cell(0, 7, _strip_inline(stripped[4:]))
                pdf.ln(1)

            elif stripped.startswith("#### "):
                pdf.set_font("Helvetica", "BI", 11)
                pdf.set_text_color(60, 60, 60)
                pdf.multi_cell(0, 6, _strip_inline(stripped[5:]))

            elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] ") or stripped.startswith("- [X] "):
                checked = stripped[3] in ("x", "X")
                text = ("[x] " if checked else "[ ] ") + _strip_inline(stripped[6:])
                pdf.set_font("Helvetica", "", 11)
                pdf.set_text_color(60, 60, 60)
                pdf.set_x(26)
                pdf.multi_cell(0, 6, text)

            elif stripped.startswith("- ") or stripped.startswith("* "):
                indent = len(raw) - len(raw.lstrip())
                bullet_text = _strip_inline(stripped[2:])
                pdf.set_font("Helvetica", "", 11)
                pdf.set_text_color(60, 60, 60)
                left_margin = 20 + min(indent // 2, 3) * 4
                pdf.set_x(left_margin)
                pdf.cell(5, 6, chr(149))
                pdf.multi_cell(0, 6, bullet_text)

            elif stripped and stripped[0].isdigit() and ". " in stripped[:5]:
                pdf.set_font("Helvetica", "", 11)
                pdf.set_text_color(60, 60, 60)
                pdf.set_x(24)
                pdf.multi_cell(0, 6, _strip_inline(stripped))

            elif stripped.startswith("|") and not _is_table_sep(stripped):
                cols = [_strip_inline(c.strip()) for c in stripped.strip("|").split("|")]
                n = max(len(cols), 1)
                avail_w = pdf.w - pdf.l_margin - pdf.r_margin
                is_header = i + 1 < len(lines) and _is_table_sep(lines[i + 1])

                if n == 1:
                    col_widths = [avail_w]
                elif n == 2:
                    col_widths = [avail_w * 0.38, avail_w * 0.62]
                elif n == 3:
                    col_widths = [avail_w * 0.30, avail_w * 0.17, avail_w * 0.53]
                else:
                    col_widths = [avail_w / n] * n

                line_h = 5
                padding = 1.0

                def _render_row(col_texts, widths, font_style, fill_color, text_color, do_fill):
                    pdf.set_font("Helvetica", font_style, 9)
                    space_w = pdf.get_string_width(" ")

                    # Simulate word-wrap to determine the required row height
                    max_lines = 1
                    for text, w in zip(col_texts, widths):
                        inner = max(w - 2 * padding, 1)
                        if not text:
                            continue
                        ln_count = 1
                        cur_w = 0.0
                        for word in (text or "").split(" "):
                            if not word:
                                continue
                            ww = pdf.get_string_width(word)
                            if ww > inner:
                                # Word wider than cell: fpdf2 breaks at char boundary.
                                # If there's already content on the current line, leave it first.
                                if cur_w > 0:
                                    ln_count += 1
                                    cur_w = 0.0
                                extra = math.ceil(ww / inner) - 1
                                ln_count += extra
                                cur_w = ww - extra * inner
                            elif cur_w == 0:
                                cur_w = ww
                            elif cur_w + space_w + ww <= inner:
                                cur_w += space_w + ww
                            else:
                                ln_count += 1
                                cur_w = ww
                        max_lines = max(max_lines, ln_count)

                    # Include top + bottom padding so text never overflows the border rect
                    row_h = max_lines * line_h + 2 * padding + 1

                    if pdf.will_page_break(row_h):
                        pdf.add_page()

                    x0, y0 = pdf.l_margin, pdf.get_y()

                    # Draw uniform-height cell borders
                    pdf.set_draw_color(100, 100, 100)
                    cur_x = x0
                    for w in widths:
                        style = "FD" if do_fill else "D"
                        if do_fill:
                            pdf.set_fill_color(*fill_color)
                        pdf.rect(cur_x, y0, w, row_h, style)
                        cur_x += w

                    # Render text inside each cell
                    pdf.set_text_color(*text_color)
                    cur_x = x0
                    for text, w in zip(col_texts, widths):
                        pdf.set_xy(cur_x + padding, y0 + padding)
                        pdf.multi_cell(w - 2 * padding, line_h, text,
                                       border=0, fill=False, align="L")
                        cur_x += w

                    pdf.set_xy(x0, y0 + row_h)

                if is_header:
                    _render_row(cols, col_widths, "B", (215, 215, 215), (30, 30, 30), True)
                    i += 2
                    continue
                else:
                    _render_row(cols, col_widths, "", (255, 255, 255), (60, 60, 60), False)

            elif stripped.startswith("**") and stripped.endswith("**") and len(stripped) > 4:
                pdf.set_font("Helvetica", "B", 11)
                pdf.set_text_color(40, 40, 40)
                pdf.multi_cell(0, 6, _to_latin1(stripped[2:-2].strip()))

            elif stripped in ("---", "***", "___"):
                pdf.ln(2)
                pdf.set_draw_color(200, 200, 200)
                pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
                pdf.ln(2)

            elif stripped == "":
                pdf.ln(2)

            else:
                pdf.set_font("Helvetica", "", 11)
                pdf.set_text_color(60, 60, 60)
                pdf.multi_cell(0, 6, _strip_inline(stripped))

            i += 1

        return bytes(pdf.output())
