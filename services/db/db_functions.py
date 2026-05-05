import json
import os
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import psycopg2
from psycopg2 import sql
from utils.set_environment import set_environment

set_environment("postgres")
set_environment("databases")

DB_NAME = os.getenv("POSTGRES_DB")
DB_USER = os.getenv("POSTGRES_USER")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD")
DB_HOST = os.getenv("POSTGRES_HOST")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")
CORE_SCHEMA = os.getenv("CORE_GLUE_DB_NAME", "core")
RISK_MANAGEMENT_SCHEMA = os.getenv("RISK_MANAGEMENT_GLUE_DB_NAME", "risk_management")
CURATED_SCHEMA = os.getenv("CURATED_GLUE_DB_NAME", "curated")

ALL_RISK_STATES = [
    "Ready to take",
    "In progress",
    "Ready to finalize",
    "Completed",
    "Failed",
    "Cancelled",
]
ACTIVE_RISK_STATES = ["Ready to take", "In progress", "Ready to finalize"]


@contextmanager
def _db_connection():
    missing = [
        name
        for name, value in {
            "POSTGRES_DB": DB_NAME,
            "POSTGRES_USER": DB_USER,
            "POSTGRES_PASSWORD": DB_PASSWORD,
            "POSTGRES_HOST": DB_HOST,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing Postgres config values: {', '.join(missing)}")

    connection = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
    )
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _table(schema_name: str, table_name: str) -> sql.Composed:
    return sql.SQL("{}.{}").format(sql.Identifier(schema_name), sql.Identifier(table_name))


def _regulatory_risk_score(risk_classification: str) -> float:
    mapping = {
        "Prohibited": 10.0,
        "High Risk": 7.0,
    }
    return mapping.get(risk_classification, 1.0)


def _execute_insert(cursor, assessment_id: str, created_ts: datetime, updated_ts: datetime, type_of_risk: str, response_data: dict) -> None:
    article_5 = json.dumps(response_data["article_5"])
    article_6 = json.dumps(response_data["article_6"])
    agent_name = response_data["agent_name"]

    insert_query = sql.SQL(
        """
        INSERT INTO {risk_table} (
            assessment_id,
            agent_internal_id,
            agent_id,
            agent_name,
            agent_risk_assessment_name,
            risk_classification,
            personally_identifiable_information,
            protected_health_information,
            payment_card_industry,
            eu_ai_act_article_5_prohibited_ai_practices_evaluation,
            eu_ai_act_article_6_high_risk_ai_systems_evaluation,
            risk_classification_rationale,
            type_of_risk,
            created_ts,
            created_by,
            updated_ts,
            updated_by,
            assessor,
            state
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """
    ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))

    cursor.execute(
        insert_query,
        (
            assessment_id,
            response_data["agent_internal_id"],
            response_data["agent_id"],
            agent_name,
            f"{agent_name}_Assessment_{created_ts:%Y-%m-%d}",
            response_data["risk_classification"],
            response_data["personally_identifiable_information"],
            response_data["protected_health_information"],
            response_data["payment_card_industry"],
            article_5,
            article_6,
            response_data["risk_rating_rationale"],
            type_of_risk,
            created_ts,
            "Admin",
            updated_ts,
            "Admin",
            "Admin",
            "Completed",
        ),
    )


def insert_or_update_into_postgres(response_data: dict) -> str:
    now_ts = datetime.now()
    assessment_id = str(uuid.uuid4())
    agent_internal_id = response_data["agent_internal_id"]

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            check_query = sql.SQL(
                """
                SELECT assessment_id, state
                FROM {risk_table}
                WHERE agent_internal_id = %s
                  AND state = ANY(%s)
                """
            ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))
            cursor.execute(check_query, (agent_internal_id, ALL_RISK_STATES))
            rows = cursor.fetchall()

            type_of_risk = "Residual Risk" if rows else "Inherent Risk"
            active_row = next((row for row in rows if row[1] in ACTIVE_RISK_STATES), None)

            if active_row:
                existing_assessment_id = active_row[0]
                update_query = sql.SQL(
                    """
                    UPDATE {risk_table}
                    SET
                        risk_classification = %s,
                        personally_identifiable_information = %s,
                        protected_health_information = %s,
                        payment_card_industry = %s,
                        eu_ai_act_article_5_prohibited_ai_practices_evaluation = %s,
                        eu_ai_act_article_6_high_risk_ai_systems_evaluation = %s,
                        risk_classification_rationale = %s,
                        type_of_risk = %s,
                        state = %s,
                        updated_ts = %s,
                        updated_by = %s
                    WHERE agent_internal_id = %s
                      AND state = ANY(%s)
                    """
                ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))
                cursor.execute(
                    update_query,
                    (
                        response_data["risk_classification"],
                        response_data["personally_identifiable_information"],
                        response_data["protected_health_information"],
                        response_data["payment_card_industry"],
                        json.dumps(response_data["article_5"]),
                        json.dumps(response_data["article_6"]),
                        response_data["risk_rating_rationale"],
                        type_of_risk,
                        "Completed",
                        now_ts,
                        "Admin",
                        agent_internal_id,
                        ACTIVE_RISK_STATES,
                    ),
                )
                return existing_assessment_id

            _execute_insert(cursor, assessment_id, now_ts, now_ts, type_of_risk, response_data)
            return assessment_id


def get_assessment_name(risk_assessment_id: str) -> str:
    with _db_connection() as connection:
        with connection.cursor() as cursor:
            query = sql.SQL(
                """
                SELECT agent_risk_assessment_name
                FROM {risk_table}
                WHERE assessment_id = %s
                LIMIT 1
                """
            ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))
            cursor.execute(query, (risk_assessment_id,))
            row = cursor.fetchone()

    if not row:
        raise Exception(f"No assessment found for ID: {risk_assessment_id}")
    return row[0]


def insert_core_risk_assessment(
    agent_internal_id: str,
    agent_id: str,
    risk_assessment_id: str,
    risk_classification: str,
    created_ts: str,
) -> None:
    created_at = datetime.strptime(created_ts, "%Y-%m-%d %H:%M:%S")
    regulatory_risk_score = _regulatory_risk_score(risk_classification)
    assessment_name = get_assessment_name(risk_assessment_id)

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            query = sql.SQL(
                """
                INSERT INTO {core_table} (
                    risk_assessment_id,
                    agent_internal_id,
                    agent_id,
                    assessment_name,
                    assessor_name,
                    assessment_ts,
                    regulatory_risk_score,
                    regulatory_risk_class,
                    state_name,
                    is_current,
                    created_ts,
                    updated_ts
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """
            ).format(core_table=_table(CORE_SCHEMA, "agent_risk_assessments"))
            cursor.execute(
                query,
                (
                    risk_assessment_id,
                    agent_internal_id,
                    agent_id,
                    assessment_name,
                    "Admin",
                    created_at,
                    regulatory_risk_score,
                    risk_classification,
                    "Completed",
                    True,
                    created_at,
                    created_at,
                ),
            )


def update_agent_data_sensitivity_flags(
    agent_internal_id: str,
    agent_id: str,
    personally_identifiable_information: str,
    protected_health_information: str,
    payment_card_industry: str,
) -> None:
    def _to_bool(value: str) -> bool:
        return str(value).strip().lower() == "yes"

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            query = sql.SQL(
                """
                UPDATE {data_sources_table}
                SET
                    contains_pii = %s,
                    contains_phi = %s,
                    contains_pci = %s,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE agent_internal_id = %s
                  AND (
                    (source_object_type = 'Agent' AND source_object_id = %s)
                    OR
                    (target_object_type = 'Agent' AND target_object_id = %s)
                  )
                """
            ).format(data_sources_table=_table(CORE_SCHEMA, "agent_data_sources"))
            cursor.execute(
                query,
                (
                    _to_bool(personally_identifiable_information),
                    _to_bool(protected_health_information),
                    _to_bool(payment_card_industry),
                    agent_internal_id,
                    agent_id,
                    agent_id,
                ),
            )


def refresh_curated_agent_360(agent_internal_id: str, agent_id: str) -> dict:
    with _db_connection() as connection:
        with connection.cursor() as cursor:
            delete_query = sql.SQL(
                """
                DELETE FROM {agent_360_table}
                WHERE agent_internal_id = %s
                   OR agent_id = %s
                """
            ).format(agent_360_table=_table(CURATED_SCHEMA, "agent_360"))
            cursor.execute(delete_query, (agent_internal_id, agent_id))
            deleted_rows = cursor.rowcount

            insert_query = sql.SQL(
                """
                INSERT INTO {agent_360_table} (
                    tenant_id,
                    agent_id,
                    agent_name,
                    agent_description,
                    autonomy_level,
                    memory_type,
                    reasoning_model,
                    tool_count,
                    data_source_count,
                    business_application_count,
                    business_process_count,
                    ai_model_count,
                    primary_ai_model_name,
                    primary_ai_model_provider,
                    contains_pii,
                    contains_phi,
                    contains_pci,
                    latest_risk_score,
                    latest_risk_class,
                    latest_event_status,
                    snapshot_ts,
                    agent_internal_id,
                    summary
                )
                SELECT
                    a.tenant_id,
                    a.agent_id,
                    a.agent_name,
                    a.agent_description,
                    cfg.autonomy_level,
                    cfg.memory_type,
                    cfg.reasoning_model,
                    COALESCE(tools.tool_count, 0),
                    COALESCE(data_sources.data_source_count, 0),
                    COALESCE(apps.business_application_count, 0),
                    COALESCE(processes.business_process_count, 0),
                    COALESCE(models.ai_model_count, 0),
                    primary_model.model_name,
                    primary_model.model_provider,
                    COALESCE(data_sources.contains_pii, FALSE),
                    COALESCE(data_sources.contains_phi, FALSE),
                    COALESCE(data_sources.contains_pci, FALSE),
                    COALESCE(risk.blended_risk_score, risk.regulatory_risk_score),
                    COALESCE(risk.blended_risk_class, risk.regulatory_risk_class),
                    latest_event.status,
                    CURRENT_TIMESTAMP,
                    a.agent_internal_id,
                    risk.summary
                FROM {agents_table} a
                LEFT JOIN {config_table} cfg
                    ON cfg.agent_internal_id = a.agent_internal_id
                   AND COALESCE(cfg.is_current, TRUE) = TRUE
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS tool_count
                    FROM {tools_table}
                    GROUP BY agent_internal_id
                ) tools
                    ON tools.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT
                        agent_internal_id,
                        COUNT(*)::bigint AS data_source_count,
                        BOOL_OR(COALESCE(contains_pii, FALSE)) AS contains_pii,
                        BOOL_OR(COALESCE(contains_phi, FALSE)) AS contains_phi,
                        BOOL_OR(COALESCE(contains_pci, FALSE)) AS contains_pci
                    FROM {data_sources_table}
                    GROUP BY agent_internal_id
                ) data_sources
                    ON data_sources.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS business_application_count
                    FROM {applications_table}
                    GROUP BY agent_internal_id
                ) apps
                    ON apps.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS business_process_count
                    FROM {processes_table}
                    GROUP BY agent_internal_id
                ) processes
                    ON processes.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS ai_model_count
                    FROM {models_table}
                    GROUP BY agent_internal_id
                ) models
                    ON models.agent_internal_id = a.agent_internal_id
                LEFT JOIN LATERAL (
                    SELECT model_name, model_provider
                    FROM {models_table} m
                    WHERE m.agent_internal_id = a.agent_internal_id
                    ORDER BY COALESCE(m.is_primary_model, FALSE) DESC, m.created_ts DESC NULLS LAST
                    LIMIT 1
                ) primary_model ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        blended_risk_score,
                        blended_risk_class,
                        regulatory_risk_score,
                        regulatory_risk_class,
                        state_name,
                        summary
                    FROM {risk_table} r
                    WHERE r.agent_internal_id = a.agent_internal_id
                    ORDER BY r.assessment_ts DESC NULLS LAST, r.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) risk ON TRUE
                LEFT JOIN LATERAL (
                    SELECT status
                    FROM {governance_events_table} ge
                    WHERE ge.agent_internal_id = a.agent_internal_id
                    ORDER BY ge.event_ts DESC NULLS LAST, ge.created_ts DESC NULLS LAST
                    LIMIT 1
                ) latest_event ON TRUE
                WHERE a.agent_internal_id = %s
                  AND COALESCE(a.is_current, TRUE) = TRUE
                """
            ).format(
                agent_360_table=_table(CURATED_SCHEMA, "agent_360"),
                agents_table=_table(CORE_SCHEMA, "agents"),
                config_table=_table(CORE_SCHEMA, "agent_configurations"),
                tools_table=_table(CORE_SCHEMA, "agent_tools"),
                data_sources_table=_table(CORE_SCHEMA, "agent_data_sources"),
                applications_table=_table(CORE_SCHEMA, "agent_business_applications"),
                processes_table=_table(CORE_SCHEMA, "agent_business_processes"),
                models_table=_table(CORE_SCHEMA, "agent_ai_models"),
                governance_events_table=_table(CORE_SCHEMA, "agent_governance_events"),
                risk_table=_table(CORE_SCHEMA, "agent_risk_assessments"),
            )
            cursor.execute(insert_query, (agent_internal_id,))
            inserted_rows = cursor.rowcount

    return {
        "agent_internal_id": agent_internal_id,
        "agent_id": agent_id,
        "deleted_rows": deleted_rows,
        "inserted_rows": inserted_rows,
    }


def _val(row: dict, key: str):
    value = row.get(key) if row else None
    if value in (None, "", "null", "NULL"):
        return None
    return value


def _query_core_rows(cursor, table_name: str, agent_internal_id: str):
    query = sql.SQL("SELECT * FROM {} WHERE agent_internal_id = %s").format(
        _table(CORE_SCHEMA, table_name)
    )
    cursor.execute(query, (agent_internal_id,))
    rows = cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def create_local_agent_card(agent_internal_id: str, output_dir: str = None) -> dict:
    # Mirrors index.py card shape, but sources data from Postgres core schema.
    table_names = [
        "agents",
        "agent_identifications",
        "agent_configurations",
        "agent_ai_use_cases",
        "agent_business_applications",
        "agent_ai_models",
        "agent_business_processes",
        "agent_physical_ai",
        "agent_llm_models",
        "agent_guardrails",
        "agent_mcp_servers",
        "agent_tools",
        "agent_data_sources",
        "agent_knowledge_sources",
        "agent_prompt_templates",
        "agent_memories",
        "agent_regulations_or_frameworks",
        "agent_controls",
        "agent_risk_assessments",
    ]

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            data = {name: _query_core_rows(cursor, name, agent_internal_id) for name in table_names}

    def first(name: str) -> dict:
        rows = data.get(name, [])
        return rows[0] if rows else {}

    ag = first("agents")
    if not ag:
        raise ValueError(f"No core.agents record found for agent_internal_id={agent_internal_id}")

    ai = first("agent_identifications")
    ac = first("agent_configurations")
    ara = first("agent_risk_assessments")
    agl = first("agent_guardrails")
    ams = first("agent_mcp_servers")
    aks = first("agent_knowledge_sources")
    apt = first("agent_prompt_templates")
    amem = first("agent_memories")
    arf = first("agent_regulations_or_frameworks")

    use_cases = data["agent_ai_use_cases"]
    apps = data["agent_business_applications"]
    ai_models = data["agent_ai_models"]
    biz_procs = data["agent_business_processes"]
    phys_ai = data["agent_physical_ai"]
    llm_models = data["agent_llm_models"]
    tools = data["agent_tools"]
    dsources = data["agent_data_sources"]
    controls = data["agent_controls"]

    card = {
        "capabilities": {"streaming": False},
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "name": _val(ag, "agent_name"),
        "description": _val(ag, "agent_description"),
        "preferredTransport": "JSONRPC",
        "protocol_version": _val(ag, "protocol_version"),
        "instruction_sets": [],
        "skills": [],
        "provider": {
            "organization": _val(ag, "source_system"),
            "url": "",
        },
        "url": "",
        "documentation_url": None,
        "icon_url": None,
        "security": None,
        "security_schemes": None,
        "signatures": None,
        "supports_authenticated_extended_card": True,
        "additional_interfaces": None,
        "version": _val(ag, "card_version"),
        "identification": {
            "agent_id": _val(ag, "agent_id"),
            "agent_internal_id": agent_internal_id,
            "goal_orientation": _val(ai, "goal_orientation"),
            "role": _val(ai, "role"),
            "instruction": _val(ai, "instruction"),
            "owner": _val(ai, "owner"),
            "environment": _val(ai, "environment"),
            "tags": _val(ai, "tags"),
            "governance_status": _val(ai, "governance_status"),
            "reviewer": _val(ai, "reviewer"),
            "cost_center": _val(ai, "cost_center"),
        },
        "configuration": {
            "access_scope": _val(ac, "access_scope"),
            "memory_type": _val(ac, "memory_type"),
            "data_freshness_policy": _val(ac, "data_freshness_policy"),
            "autonomy_level": _val(ac, "autonomy_level"),
            "reasoning_model": _val(ac, "reasoning_model"),
        },
        "ai_use_case": [{
            "identifier": _val(r, "identifier"),
            "name": _val(r, "name"),
            "description": _val(r, "description"),
            "proposed_by": _val(r, "proposed_by"),
            "owner": _val(r, "owner"),
            "business_function": _val(r, "business_function"),
            "problem_statement": _val(r, "problem_statement"),
            "expected_benefits": _val(r, "expected_benefits"),
            "priority": _val(r, "priority"),
            "status": _val(r, "status"),
        } for r in use_cases] or [{
            "identifier": None, "name": None, "description": None, "proposed_by": None,
            "owner": None, "business_function": None, "problem_statement": None,
            "expected_benefits": None, "priority": None, "status": None,
        }],
        "application": [{
            "identifier": _val(r, "business_application_id"),
            "name": _val(r, "application_name"),
            "description": _val(r, "description"),
            "business_criticality": _val(r, "criticality"),
            "emergency_tier": _val(r, "emergency_tier"),
        } for r in apps] or [{
            "identifier": None, "name": None, "description": None,
            "business_criticality": None, "emergency_tier": None,
        }],
        "ai_model": [{
            "name": _val(r, "model_name"),
            "owner": _val(r, "owner"),
            "department_executive": _val(r, "department_executive"),
            "description": _val(r, "description"),
        } for r in ai_models] or [{
            "name": None, "owner": None, "department_executive": None, "description": None,
        }],
        "business_process": [{
            "identifier": _val(r, "business_process_id"),
            "name": _val(r, "process_name"),
            "description": _val(r, "description"),
            "business_criticality": _val(r, "criticality"),
        } for r in biz_procs] or [{
            "identifier": None, "name": None, "description": None, "business_criticality": None,
        }],
        "physical_ai": [{
            "identifier": _val(r, "identifier"),
            "name": _val(r, "name"),
            "type": _val(r, "type"),
            "sensory_input_source": _val(r, "sensory_input_source"),
        } for r in phys_ai] or [{
            "identifier": None, "name": None, "type": None, "sensory_input_source": None,
        }],
        "llm_model": [{
            "name": _val(r, "name"),
            "version_number": _val(r, "version_number"),
        } for r in llm_models] or [{
            "name": None, "version_number": None,
        }],
        "guardrail": {
            "name": _val(agl, "name"),
            "description": _val(agl, "description"),
            "model": _val(agl, "model"),
        },
        "mcp_server": {
            "name": _val(ams, "name"),
            "url": _val(ams, "url"),
            "version_number": _val(ams, "version_number"),
        },
        "tool": [{
            "identifier": _val(r, "tool_id"),
            "name": _val(r, "tool_name"),
            "description": _val(r, "tool_description"),
            "delegation_possible": _val(r, "delegation_possible"),
            "allowed_delegates": _val(r, "allowed_delegates"),
            "parameter_name": None,
            "parameter_type": None,
            "default_value": _val(r, "default_config_json_text"),
            "input_schema": _val(r, "input_schema_json_text"),
            "output_schema": _val(r, "output_schema_json_text"),
        } for r in tools] or [{
            "identifier": None, "name": None, "description": None, "delegation_possible": None,
            "allowed_delegates": None, "parameter_name": None, "parameter_type": None,
            "default_value": None, "input_schema": None, "output_schema": None,
        }],
        "data_source": [{
            "relationship_id": _val(r, "relationship_id"),
            "parent_relationship_id": _val(r, "parent_relationship_id"),
            "source_object_id": _val(r, "source_object_id"),
            "source_object_domain": _val(r, "source_object_domain"),
            "source_object_name": _val(r, "source_object_name"),
            "source_object_type": _val(r, "source_object_type"),
            "target_object_id": _val(r, "target_object_id"),
            "target_object_domain": _val(r, "target_object_domain"),
            "target_object_name": _val(r, "target_object_name"),
            "target_object_type": _val(r, "target_object_type"),
            "access_level": _val(r, "access_level"),
            "uses_pii": _val(r, "contains_pii"),
            "uses_phi": _val(r, "contains_phi"),
            "uses_pci": _val(r, "contains_pci"),
        } for r in dsources] or [{
            "relationship_id": None, "parent_relationship_id": None, "source_object_id": None,
            "source_object_domain": None, "source_object_name": None, "source_object_type": None,
            "target_object_id": None, "target_object_domain": None, "target_object_name": None,
            "target_object_type": None, "access_level": None, "uses_pii": None,
            "uses_phi": None, "uses_pci": None,
        }],
        "knowledge_source": {
            "identifier": _val(aks, "identifier"),
            "name": _val(aks, "name"),
            "access_mechanism": _val(aks, "access_mechanism"),
        },
        "prompt_template": {
            "identifier": _val(apt, "identifier"),
            "name": _val(apt, "name"),
            "description": _val(apt, "description"),
        },
        "memory": {
            "identifier": _val(amem, "identifier"),
            "name": _val(amem, "name"),
            "type": _val(amem, "type"),
        },
        "regulation_or_framework": {
            "name": _val(arf, "name"),
            "type": _val(arf, "name"),
            "regulatory_authority": _val(arf, "regulatory_authority"),
            "jurisdiction": _val(arf, "jurisdiction"),
            "requirement": _val(arf, "requirement"),
        },
        "control": [{
            "identifier": _val(r, "identifier"),
            "name": _val(r, "name"),
            "objective": _val(r, "objective"),
            "domain": _val(r, "domain"),
        } for r in controls] or [{
            "identifier": None, "name": None, "objective": None, "domain": None,
        }],
        "risk_assessment": {
            "identifier": _val(ara, "risk_assessment_id"),
            "name": _val(ara, "assessment_name"),
            "assessor": _val(ara, "assessor_name"),
            "date": _val(ara, "assessment_ts"),
            "blended_risk_score": _val(ara, "blended_risk_score"),
            "blended_risk_class": _val(ara, "blended_risk_class"),
            "aivss_score": _val(ara, "aivss_score"),
            "aivss_classification": _val(ara, "aivss_class"),
            "regulatory_risk_score": _val(ara, "regulatory_risk_score"),
            "regulatory_risk_classification": _val(ara, "regulatory_risk_class"),
            "state": _val(ara, "state_name"),
            "summary": _val(ara, "summary"),
        },
    }

    target_dir = Path(output_dir or os.getenv("LOCAL_AGENT_CARD_DIR", "./agent_cards"))
    target_dir.mkdir(parents=True, exist_ok=True)
    agent_id = _val(ag, "agent_id") or agent_internal_id
    file_path = target_dir / f"{agent_id}_agent_card.json"
    with file_path.open("w", encoding="utf-8") as f:
        json.dump(card, f, indent=2, default=str)

    return {
        "agent_internal_id": agent_internal_id,
        "agent_id": agent_id,
        "file_path": str(file_path.resolve()),
    }
