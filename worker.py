import os
import json
import hashlib
import time
import tempfile
from concurrent.futures import ThreadPoolExecutor
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from utils.db import DATABASE_URL, SyncSessionLocal, sync_engine

from tavro_agent_card import TavroAgentCard

API_URL = os.getenv("API_URL", "http://tavro-api:8000/api/v1/risk/classify-risk")
API_DISPATCH_MAX_WORKERS = int(os.getenv("API_DISPATCH_MAX_WORKERS", "20"))
# Default tenant assigned to all agents loaded via the worker / connectors.
# Set TENANT_ID in the container environment (docker-compose or .env).
TENANT_ID = os.getenv("TENANT_ID", "")
WAIT_FOR_API_DISPATCH = os.getenv("WAIT_FOR_API_DISPATCH", "false").strip().lower() == "true"
_api_dispatch_pool = ThreadPoolExecutor(max_workers=API_DISPATCH_MAX_WORKERS)
_api_dispatch_futures = []

# ── Connection pool ───────────────────────────────────────────────────────────
# SQLAlchemy manages the pool via sync_engine (defined in utils/db.py).
# init_pool() is kept as a public API so connectors can call it before
# processing cards — it now verifies connectivity with the same retry logic.

_MAX_RETRIES = 10
_RETRY_DELAY = 3


def init_pool():
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            with sync_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("DB pool initialised.")
            return
        except OperationalError as e:
            print(f"DB not ready (attempt {attempt}/{_MAX_RETRIES}): {e}")
            if attempt < _MAX_RETRIES:
                print(f"Retrying in {_RETRY_DELAY}s ...")
                time.sleep(_RETRY_DELAY)
            else:
                raise RuntimeError("Could not connect to DB after maximum retries.")


def close_pool():
    sync_engine.dispose()
    print("DB pool closed.")


# ══════════════════════════════════════════════════════════════════════════════
# DB helpers  (replace Athena start/poll/fetch)
# ══════════════════════════════════════════════════════════════════════════════

def execute_query(sql: str) -> list:
    """Execute a SELECT and return rows as a list of dicts."""
    with SyncSessionLocal() as session:
        result = session.execute(text(sql))
        return [dict(row) for row in result.mappings()]


def execute_dml(sql: str, label: str = ""):
    """Execute a DML statement (INSERT / UPDATE / DELETE)."""
    with SyncSessionLocal() as session:
        session.execute(text(sql))
        session.commit()
        print(f"  ✓ {label} succeeded")




# ══════════════════════════════════════════════════════════════════════════════
# SQL value helpers  (unchanged from Lambda)
# ══════════════════════════════════════════════════════════════════════════════

def _hash(obj) -> str:
    raw = json.dumps(obj, sort_keys=True, default=str) if obj is not None else ""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _sq(val) -> str:
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def _bool(val) -> str:
    if val is None:
        return "NULL"
    return "true" if val else "false"


def _array_str(lst) -> str:
    # Postgres needs an explicit cast on an empty array literal
    if not lst:
        return "ARRAY[]::text[]"
    items = ", ".join(f"'{str(i).replace(chr(39), chr(39)+chr(39))}'" for i in lst)
    return f"ARRAY[{items}]"


# ══════════════════════════════════════════════════════════════════════════════
# SKIP EMPTY PAYLOAD  (unchanged)
# ══════════════════════════════════════════════════════════════════════════════

def has_meaningful_data(data) -> bool:
    def is_meaningful(value):
        if value is None:
            return False
        if isinstance(value, str) and value.strip() == "":
            return False
        if isinstance(value, (list, dict)) and len(value) == 0:
            return False
        return True

    if isinstance(data, dict):
        return any(is_meaningful(v) for v in data.values())
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                if any(is_meaningful(v) for v in item.values()):
                    return True
        return False
    return False


# ══════════════════════════════════════════════════════════════════════════════
# SOURCE HASH CHECK  (unchanged logic — SQL is identical Postgres / Athena)
# ══════════════════════════════════════════════════════════════════════════════

def get_current_agent_source_hash(agent_id: str):
    sql = f"""
        SELECT source_hash
        FROM core.agents
        WHERE agent_id = {_sq(agent_id)}
          AND is_current = true
        ORDER BY updated_ts DESC
        LIMIT 1
    """
    result = execute_query(sql)
    return result[0].get("source_hash") if result else None


# ══════════════════════════════════════════════════════════════════════════════
# UPSERTS  — same logic as Lambda; MERGE INTO → INSERT … ON CONFLICT DO UPDATE
#
# Required unique indexes (add to init.sql):
#
#   CREATE UNIQUE INDEX ON core.agents (agent_id, agent_name) WHERE is_current = true;
#   CREATE UNIQUE INDEX ON core.agent_configurations (agent_internal_id) WHERE is_current = true;
#   CREATE UNIQUE INDEX ON core.agent_identifications (agent_internal_id) WHERE is_current = true;
#   CREATE UNIQUE INDEX ON core.agent_tools (agent_internal_id, tool_id);
#   CREATE UNIQUE INDEX ON core.agent_controls (agent_internal_id, name);
#   CREATE UNIQUE INDEX ON core.agent_knowledge_sources (agent_internal_id);
#   CREATE UNIQUE INDEX ON core.agent_llm_models (agent_internal_id, name);
#   CREATE UNIQUE INDEX ON core.agent_ai_use_cases (tenant_id, ai_use_case_id, agent_id);
#   CREATE UNIQUE INDEX ON core.agent_business_processes (agent_internal_id, business_process_id);
#   CREATE UNIQUE INDEX ON core.agent_business_applications (agent_internal_id, business_application_id);
#   CREATE UNIQUE INDEX ON core.agent_guardrails (agent_internal_id, name);
#   CREATE UNIQUE INDEX ON core.agent_mcp_servers (agent_internal_id);
#   CREATE UNIQUE INDEX ON core.agent_memories (agent_internal_id);
#   CREATE UNIQUE INDEX ON core.agent_physical_ai (agent_internal_id, name);
#   CREATE UNIQUE INDEX ON core.agent_prompt_templates (agent_internal_id);
#   CREATE UNIQUE INDEX ON core.agent_regulations_or_frameworks (agent_internal_id);
#   CREATE UNIQUE INDEX ON core.agent_ai_models (agent_internal_id, model_name);
#   CREATE UNIQUE INDEX ON core.agent_data_sources (agent_internal_id, source_object_id, target_object_id);
# ══════════════════════════════════════════════════════════════════════════════

def upsert_agent(card: dict, now_str: str, incoming_source_hash: str = None) -> str:
    ident    = card.get("identification", {})
    agent_id = ident.get("agent_id")
    incoming_internal_id = ident.get("agent_internal_id")
    tenant_id = ident.get("tenant_id") or TENANT_ID or None
    tenant_id_sql = "NULL" if not tenant_id else _sq(tenant_id)

    row = {
        "agent_name":             card.get("name"),
        "agent_description":      card.get("description"),
        "protocol_version":       card.get("protocol_version"),
        "preferred_transport":    card.get("preferredTransport"),
        "supports_auth_ext_card": card.get("supports_authenticated_extended_card"),
        "card_version":           card.get("version"),
        "source_system":          card.get("provider", {}).get("organization"),
    }

    source_hash = incoming_source_hash or _hash(card)
    record_hash = _hash(row)

    # Look up existing agent_internal_id
    lookup_sql = f"""
        SELECT agent_internal_id
        FROM core.agents
        WHERE agent_id = {_sq(agent_id)}
        LIMIT 1
    """
    print("  Looking up existing agent_internal_id …")
    result = execute_query(lookup_sql)

    if result:
        agent_internal_id = result[0]["agent_internal_id"]
        print(f"  Found existing agent_internal_id={agent_internal_id} → UPDATE")
    else:
        agent_internal_id = incoming_internal_id
        print(f"  No match → INSERT with agent_internal_id={agent_internal_id}")

    sql = f"""
        INSERT INTO core.agents (
            agent_id, agent_internal_id, agent_name, agent_description,
            protocol_version, preferred_transport, supports_auth_ext_card,
            card_version, source_hash, source_system, record_hash,
            tenant_id,
            valid_from_ts, valid_to_ts, is_current, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_id)}, {_sq(agent_internal_id)}, {_sq(row['agent_name'])},
            {_sq(row['agent_description'])}, {_sq(row['protocol_version'])},
            {_sq(row['preferred_transport'])}, {_bool(row['supports_auth_ext_card'])},
            {_sq(row['card_version'])}, {_sq(source_hash)}, {_sq(row['source_system'])},
            {_sq(record_hash)},
            {tenant_id_sql},
            TIMESTAMP '{now_str}', NULL, true,
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_id, agent_name) WHERE is_current = true
        DO UPDATE SET
            agent_internal_id      = EXCLUDED.agent_internal_id,
            agent_description      = EXCLUDED.agent_description,
            protocol_version       = EXCLUDED.protocol_version,
            preferred_transport    = EXCLUDED.preferred_transport,
            supports_auth_ext_card = EXCLUDED.supports_auth_ext_card,
            card_version           = EXCLUDED.card_version,
            source_hash            = EXCLUDED.source_hash,
            source_system          = EXCLUDED.source_system,
            record_hash            = EXCLUDED.record_hash,
            tenant_id              = EXCLUDED.tenant_id,
            updated_ts             = EXCLUDED.updated_ts
    """
    print("  Upserting agents …")
    execute_dml(sql, label="agents INSERT ON CONFLICT")
    return agent_internal_id


def upsert_agent_configuration(card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    cfg   = card.get("configuration", {})
    if not has_meaningful_data(cfg):
        print("Skipping agent_configurations: all values are null/empty.")
        return

    caps = card.get("capabilities", {})
    agent_id = ident.get("agent_id")
    execution_mode = "streaming" if caps.get("streaming") else "batch"

    row = {
        "access_scope":           cfg.get("access_scope"),
        "memory_type":            cfg.get("memory_type"),
        "data_freshness_policy":  cfg.get("data_freshness_policy"),
        "autonomy_level":         cfg.get("autonomy_level"),
        "reasoning_model":        cfg.get("reasoning_model"),
        "human_in_the_loop_flag": None,
        "execution_mode":         execution_mode,
    }
    record_hash = _hash(row)

    sql = f"""
        INSERT INTO core.agent_configurations (
            agent_internal_id, agent_id,
            access_scope, memory_type, data_freshness_policy,
            autonomy_level, reasoning_model, human_in_the_loop_flag,
            execution_mode, record_hash,
            valid_from_ts, valid_to_ts, is_current, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(row['access_scope'])}, {_sq(row['memory_type'])},
            {_sq(row['data_freshness_policy'])}, {_sq(row['autonomy_level'])},
            {_sq(row['reasoning_model'])}, {_bool(row['human_in_the_loop_flag'])},
            {_sq(row['execution_mode'])}, {_sq(record_hash)},
            TIMESTAMP '{now_str}', NULL, true,
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id) WHERE is_current = true
        DO UPDATE SET
            agent_id               = EXCLUDED.agent_id,
            access_scope           = EXCLUDED.access_scope,
            memory_type            = EXCLUDED.memory_type,
            data_freshness_policy  = EXCLUDED.data_freshness_policy,
            autonomy_level         = EXCLUDED.autonomy_level,
            reasoning_model        = EXCLUDED.reasoning_model,
            human_in_the_loop_flag = EXCLUDED.human_in_the_loop_flag,
            execution_mode         = EXCLUDED.execution_mode,
            record_hash            = EXCLUDED.record_hash,
            updated_ts             = EXCLUDED.updated_ts
    """
    print("  Upserting agent_configurations …")
    execute_dml(sql, label="agent_configurations INSERT ON CONFLICT")


def upsert_agent_identification(card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    agent_id = ident.get("agent_id")
    tags_raw = ident.get("tags")
    tags     = tags_raw if isinstance(tags_raw, list) else []

    sql = f"""
        INSERT INTO core.agent_identifications (
            agent_internal_id, agent_id,
            goal_orientation, role, instruction,
            owner, environment, tags,
            governance_status, reviewer, cost_center,
            is_current, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(ident.get('goal_orientation'))}, {_sq(ident.get('role'))},
            {_sq(ident.get('instruction'))}, {_sq(ident.get('owner'))},
            {_sq(ident.get('environment'))}, {_array_str(tags)},
            {_sq(ident.get('governance_status'))}, {_sq(ident.get('reviewer'))},
            {_sq(ident.get('cost_center'))},
            true, TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id) WHERE is_current = true
        DO UPDATE SET
            agent_id         = EXCLUDED.agent_id,
            goal_orientation = EXCLUDED.goal_orientation,
            role             = EXCLUDED.role,
            instruction      = EXCLUDED.instruction,
            owner            = EXCLUDED.owner,
            environment      = EXCLUDED.environment,
            tags             = EXCLUDED.tags,
            governance_status= EXCLUDED.governance_status,
            reviewer         = EXCLUDED.reviewer,
            cost_center      = EXCLUDED.cost_center,
            updated_ts       = EXCLUDED.updated_ts
    """
    print("  Upserting agent_identifications …")
    execute_dml(sql, label="agent_identifications INSERT ON CONFLICT")


def upsert_agent_tools(card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    tools = card.get("tool", []) or []
    if not has_meaningful_data(tools):
        print("Skipping agent_tools: all tools are empty.")
        return

    agent_id = ident.get("agent_id")
    select_rows = []

    for tool in tools:
        tool_id = tool.get("identifier")
        delegation_possible = (
            str(tool.get("delegation_possible")).lower() == "true"
            if tool.get("delegation_possible") is not None else None
        )
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}             AS agent_internal_id,
                {_sq(agent_id)}                      AS agent_id,
                {_sq(tool_id)}                       AS tool_id,
                {_sq(tool.get('name'))}              AS tool_name,
                {_sq(tool.get('description'))}       AS tool_description,
                {_bool(delegation_possible)}::boolean AS delegation_possible,
                {_sq(tool.get('allowed_delegates'))} AS allowed_delegates,
                {_sq(tool.get('input_schema'))}      AS input_schema_json_text,
                {_sq(tool.get('output_schema'))}     AS output_schema_json_text,
                {_sq(tool.get('default_value'))}     AS default_config_json_text,
                TIMESTAMP '{now_str}'                AS now_ts
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_tools (
            agent_internal_id, agent_id, tool_id, tool_name, tool_description,
            delegation_possible, allowed_delegates,
            input_schema_json_text, output_schema_json_text, default_config_json_text,
            created_ts, updated_ts
        )
        SELECT
            agent_internal_id, agent_id, tool_id, tool_name, tool_description,
            delegation_possible, allowed_delegates,
            input_schema_json_text, output_schema_json_text, default_config_json_text,
            now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, tool_id)
        DO UPDATE SET
            agent_id                 = EXCLUDED.agent_id,
            tool_description         = EXCLUDED.tool_description,
            delegation_possible      = EXCLUDED.delegation_possible,
            allowed_delegates        = EXCLUDED.allowed_delegates,
            input_schema_json_text   = EXCLUDED.input_schema_json_text,
            output_schema_json_text  = EXCLUDED.output_schema_json_text,
            default_config_json_text = EXCLUDED.default_config_json_text,
            updated_ts               = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(tools)} tools …")
    execute_dml(sql, label="agent_tools BULK INSERT ON CONFLICT")


def upsert_agent_controls(card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    controls = card.get("control", []) or []
    if not has_meaningful_data(controls):
        print("Skipping controls: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")
    select_rows = []

    for control in controls:
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}          AS agent_internal_id,
                {_sq(agent_id)}                   AS agent_id,
                {_sq(control.get('identifier'))}  AS identifier,
                {_sq(control.get('name'))}        AS name,
                {_sq(control.get('objective'))}   AS objective,
                {_sq(control.get('domain'))}      AS domain,
                TIMESTAMP '{now_str}'             AS now_ts
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_controls (
            agent_internal_id, agent_id, identifier, name, objective, domain,
            created_ts, updated_ts
        )
        SELECT
            agent_internal_id, agent_id, identifier, name, objective, domain,
            now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id   = EXCLUDED.agent_id,
            identifier = EXCLUDED.identifier,
            objective  = EXCLUDED.objective,
            domain     = EXCLUDED.domain,
            updated_ts = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(controls)} controls …")
    execute_dml(sql, label="agent_controls BULK INSERT ON CONFLICT")


def upsert_agent_knowledge_source(card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    ks       = card.get("knowledge_source", {}) or {}
    if not has_meaningful_data(ks):
        print("Skipping knowledge_source: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_knowledge_sources (
            agent_internal_id, agent_id, identifier, name, access_mechanism,
            created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(ks.get('identifier'))}, {_sq(ks.get('name'))},
            {_sq(ks.get('access_mechanism'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id         = EXCLUDED.agent_id,
            identifier       = EXCLUDED.identifier,
            name             = EXCLUDED.name,
            access_mechanism = EXCLUDED.access_mechanism,
            updated_ts       = EXCLUDED.updated_ts
    """
    print("  Upserting agent_knowledge_sources …")
    execute_dml(sql, label="agent_knowledge_sources INSERT ON CONFLICT")


def upsert_agent_llm_models(card: dict, agent_internal_id: str, now_str: str):
    ident      = card.get("identification", {})
    llm_models = card.get("llm_model", []) or []
    if not has_meaningful_data(llm_models):
        print("Skipping llm_model: all values are null/empty.")
        return

    agent_id    = ident.get("agent_id")
    select_rows = []

    for model in llm_models:
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}      AS agent_internal_id,
                {_sq(agent_id)}               AS agent_id,
                {_sq(model.get('name'))}      AS name,
                {_sq(model.get('version'))}   AS version_number,
                TIMESTAMP '{now_str}'         AS now_ts
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_llm_models (
            agent_internal_id, agent_id, name, version_number,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, name, version_number, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id       = EXCLUDED.agent_id,
            version_number = EXCLUDED.version_number,
            updated_ts     = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(llm_models)} LLM models …")
    execute_dml(sql, label="agent_llm_models BULK INSERT ON CONFLICT")


def upsert_agent_ai_use_cases(card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    ai_use_cases = card.get("ai_use_case", []) or []
    if not has_meaningful_data(ai_use_cases):
        print("Skipping ai_use_case: all values are null/empty.")
        return

    tenant_id = ident.get("tenant_id") or ""
    agent_id = ident.get("agent_id")
    agent_name = ident.get("agent_name") or card.get("name")
    select_rows = []

    for uc in ai_use_cases:
        use_case_id = uc.get("identifier") or uc.get("ai_use_case_id")
        if not _clean_text(use_case_id):
            continue
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}                  AS agent_internal_id,
                {_sq(tenant_id)}                          AS tenant_id,
                {_sq(agent_id)}                           AS agent_id,
                {_sq(agent_name)}                         AS agent_name,
                {_sq(use_case_id)}                        AS ai_use_case_id,
                {_sq(uc.get('name'))}                     AS ai_use_case_name,
                {_sq(uc.get('description'))}              AS description,
                {_sq(uc.get('proposed_by'))}              AS proposed_by,
                {_sq(uc.get('owner'))}                    AS owner,
                {_sq(uc.get('business_function'))}        AS function,
                {_sq(uc.get('problem_statement'))}        AS problem_statement,
                {_sq(uc.get('expected_benefits'))}        AS expected_benefits,
                {_sq(uc.get('priority'))}                 AS priority,
                {_sq(uc.get('status'))}                   AS status,
                NULLIF({_sq(uc.get('agent_risk_exposure_are'))}, '')::numeric(10,2) AS agent_risk_exposure_are,
                NULLIF({_sq(uc.get('no_of_associated_agents'))}, '')::int            AS no_of_associated_agents,
                {_sq(uc.get('inherent_risk_classification'))} AS inherent_risk_classification,
                {_sq(uc.get('residual_risk_classification'))} AS residual_risk_classification,
                {_sq(uc.get('agent_risk_tier_art'))}      AS agent_risk_tier_art,
                NULLIF({_sq(uc.get('blended_risk_score'))}, '')::numeric(10,2)       AS blended_risk_score,
                NULLIF({_sq(uc.get('inherent_risk_classification_score'))}, '')::numeric(10,2) AS inherent_risk_classification_score,
                NULLIF({_sq(uc.get('residual_risk_classification_score'))}, '')::numeric(10,2) AS residual_risk_classification_score,
                {_sq(uc.get('solution_approach'))}        AS solution_approach,
                TIMESTAMP '{now_str}'                     AS now_ts
        """.strip())

    if not select_rows:
        print("Skipping ai_use_case: missing identifiers.")
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    use_case_sql = f"""
        INSERT INTO core.ai_use_cases (
            tenant_id, ai_use_case_id, name, description, proposed_by, owner, function,
            problem_statement, expected_benefits, priority, status, agent_internal_id,
            agent_risk_exposure_are, no_of_associated_agents, inherent_risk_classification,
            residual_risk_classification, agent_risk_tier_art, blended_risk_score,
            inherent_risk_classification_score, residual_risk_classification_score,
            solution_approach, created_ts, updated_ts
        )
        SELECT
            tenant_id, ai_use_case_id, ai_use_case_name, description, proposed_by, owner, function,
            problem_statement, expected_benefits, priority, status, agent_internal_id,
            agent_risk_exposure_are, no_of_associated_agents, inherent_risk_classification,
            residual_risk_classification, agent_risk_tier_art, blended_risk_score,
            inherent_risk_classification_score, residual_risk_classification_score,
            solution_approach, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (tenant_id, ai_use_case_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            proposed_by = EXCLUDED.proposed_by,
            owner = EXCLUDED.owner,
            function = EXCLUDED.function,
            problem_statement = EXCLUDED.problem_statement,
            expected_benefits = EXCLUDED.expected_benefits,
            priority = EXCLUDED.priority,
            status = EXCLUDED.status,
            agent_internal_id = EXCLUDED.agent_internal_id,
            agent_risk_exposure_are = EXCLUDED.agent_risk_exposure_are,
            no_of_associated_agents = EXCLUDED.no_of_associated_agents,
            inherent_risk_classification = EXCLUDED.inherent_risk_classification,
            residual_risk_classification = EXCLUDED.residual_risk_classification,
            agent_risk_tier_art = EXCLUDED.agent_risk_tier_art,
            blended_risk_score = EXCLUDED.blended_risk_score,
            inherent_risk_classification_score = EXCLUDED.inherent_risk_classification_score,
            residual_risk_classification_score = EXCLUDED.residual_risk_classification_score,
            solution_approach = EXCLUDED.solution_approach,
            updated_ts = EXCLUDED.updated_ts
    """
    execute_dml(use_case_sql, label="ai_use_cases BULK INSERT ON CONFLICT")

    relation_sql = f"""
        INSERT INTO core.agent_ai_use_cases (
            tenant_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts
        )
        SELECT
            tenant_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name, agent_internal_id, now_ts, now_ts
        FROM ({union_all}) AS s
        WHERE agent_id IS NOT NULL AND agent_id <> ''
        ON CONFLICT (tenant_id, ai_use_case_id, agent_id)
        DO UPDATE SET
            ai_use_case_name = EXCLUDED.ai_use_case_name,
            agent_name = EXCLUDED.agent_name,
            agent_internal_id = EXCLUDED.agent_internal_id,
            updated_ts = EXCLUDED.updated_ts
    """
    execute_dml(relation_sql, label="agent_ai_use_cases BULK INSERT ON CONFLICT")

    sync_count_sql = f"""
        WITH affected AS (
            SELECT DISTINCT tenant_id, ai_use_case_id
            FROM ({union_all}) AS s
        ),
        counts AS (
            SELECT
                a.tenant_id,
                a.ai_use_case_id,
                COUNT(DISTINCT rel.agent_id) AS associated_count
            FROM affected a
            LEFT JOIN core.agent_ai_use_cases rel
              ON rel.ai_use_case_id = a.ai_use_case_id
             AND COALESCE(rel.tenant_id, '') = COALESCE(a.tenant_id, '')
             AND rel.agent_id IS NOT NULL
             AND rel.agent_id <> ''
            GROUP BY a.tenant_id, a.ai_use_case_id
        )
        UPDATE core.ai_use_cases uc
        SET
            no_of_associated_agents = c.associated_count,
            updated_ts = TIMESTAMP '{now_str}'
        FROM counts c
        WHERE uc.ai_use_case_id = c.ai_use_case_id
          AND COALESCE(uc.tenant_id, '') = COALESCE(c.tenant_id, '')
    """
    execute_dml(sync_count_sql, label="ai_use_cases associated-count sync")
    print(f"  Upserting {len(select_rows)} AI use cases …")


def _clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _canonical_entity_id(raw_identifier, raw_name):
    return _clean_text(raw_identifier) or _clean_text(raw_name)


def upsert_business_processes(card: dict, agent_internal_id: str, now_str: str):
    processes = card.get("business_process", []) or []
    if not has_meaningful_data(processes):
        print("Skipping core.business_processes: all values are null/empty.")
        return

    select_rows = []
    inserted_ids = set()
    referenced_ids = set()

    for proc in processes:
        business_process_id = _canonical_entity_id(proc.get("identifier"), proc.get("name"))
        if not business_process_id or business_process_id in inserted_ids:
            continue
        inserted_ids.add(business_process_id)
        referenced_ids.add(business_process_id)

        process_number = _clean_text(proc.get("process_number")) or business_process_id
        parent_process_id = _canonical_entity_id(
            proc.get("parent_process_id"),
            proc.get("parent_process_name"),
        )
        if parent_process_id:
            referenced_ids.add(parent_process_id)
        select_rows.append(f"""
            SELECT
                {_sq(business_process_id)}              AS business_process_id,
                {_sq(process_number)}                   AS process_number,
                {_sq(proc.get('name'))}                 AS process_name,
                {_sq(proc.get('description'))}          AS process_description,
                {_sq(parent_process_id)}                AS parent_process_id,
                {_sq(proc.get('business_criticality'))} AS business_criticality,
                TIMESTAMP '{now_str}'                   AS now_ts
        """.strip())

    if not select_rows:
        print("Skipping core.business_processes: no process identifiers found.")
        return

    process_seed_rows = "\nUNION ALL\n".join(
        f"SELECT {_sq(pid)} AS business_process_id, TIMESTAMP '{now_str}' AS now_ts"
        for pid in sorted(referenced_ids)
    )
    process_seed_sql = f"""
        INSERT INTO core.business_processes (
            business_process_id, process_number, created_ts, updated_ts
        )
        SELECT business_process_id, business_process_id, now_ts, now_ts
        FROM ({process_seed_rows}) AS seed
        ON CONFLICT (business_process_id)
        DO UPDATE SET
            updated_ts = EXCLUDED.updated_ts
    """
    execute_dml(process_seed_sql, label="business_processes SEED FOR HIERARCHY")

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.business_processes (
            business_process_id, process_number, process_name, process_description,
            parent_process_id, business_criticality, created_ts, updated_ts
        )
        SELECT
            business_process_id, process_number, process_name, process_description,
            parent_process_id, business_criticality, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (business_process_id)
        DO UPDATE SET
            process_number       = COALESCE(EXCLUDED.process_number, core.business_processes.process_number),
            process_name         = COALESCE(EXCLUDED.process_name, core.business_processes.process_name),
            process_description  = COALESCE(EXCLUDED.process_description, core.business_processes.process_description),
            parent_process_id    = COALESCE(EXCLUDED.parent_process_id, core.business_processes.parent_process_id),
            business_criticality = COALESCE(EXCLUDED.business_criticality, core.business_processes.business_criticality),
            updated_ts           = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(select_rows)} core business processes â€¦")
    execute_dml(sql, label="business_processes BULK INSERT ON CONFLICT")


def upsert_business_applications(card: dict, agent_internal_id: str, now_str: str):
    applications = card.get("application", []) or []
    if not has_meaningful_data(applications):
        print("Skipping core.business_applications: all values are null/empty.")
        return

    select_rows = []
    inserted_ids = set()

    for app in applications:
        business_application_id = _canonical_entity_id(app.get("identifier"), app.get("name"))
        if not business_application_id or business_application_id in inserted_ids:
            continue
        inserted_ids.add(business_application_id)

        select_rows.append(f"""
            SELECT
                {_sq(business_application_id)}           AS business_application_id,
                {_sq(app.get('name'))}                   AS application_name,
                {_sq(app.get('business_criticality'))}   AS business_criticality,
                {_sq(app.get('emergency_tier'))}         AS emergency_tier,
                {_sq(app.get('description'))}            AS application_description,
                TIMESTAMP '{now_str}'                    AS now_ts
        """.strip())

    if not select_rows:
        print("Skipping core.business_applications: no application identifiers found.")
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.business_applications (
            business_application_id, application_name, business_criticality,
            emergency_tier, application_description, created_ts, updated_ts
        )
        SELECT
            business_application_id, application_name, business_criticality,
            emergency_tier, application_description, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (business_application_id)
        DO UPDATE SET
            application_name        = COALESCE(EXCLUDED.application_name, core.business_applications.application_name),
            business_criticality    = COALESCE(EXCLUDED.business_criticality, core.business_applications.business_criticality),
            emergency_tier          = COALESCE(EXCLUDED.emergency_tier, core.business_applications.emergency_tier),
            application_description = COALESCE(EXCLUDED.application_description, core.business_applications.application_description),
            updated_ts              = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(select_rows)} core business applications ...")
    execute_dml(sql, label="business_applications BULK INSERT ON CONFLICT")


def upsert_agent_business_processes(card: dict, agent_internal_id: str, now_str: str):
    ident     = card.get("identification", {})
    processes = card.get("business_process", []) or []
    if not has_meaningful_data(processes):
        print("Skipping business_process: all values are null/empty.")
        return

    agent_id    = ident.get("agent_id")
    select_rows = []
    process_ids = []

    for proc in processes:
        business_process_id = _canonical_entity_id(proc.get("identifier"), proc.get("name"))
        if not business_process_id:
            continue
        process_ids.append(business_process_id)

        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}                AS agent_internal_id,
                {_sq(agent_id)}                         AS agent_id,
                {_sq(business_process_id)}              AS business_process_id,
                {_sq(proc.get('name'))}                 AS process_name,
                {_sq(proc.get('business_criticality'))} AS criticality,
                TIMESTAMP '{now_str}'                   AS now_ts
        """.strip())

    if not select_rows:
        print("Skipping business_process: no process identifiers found.")
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_business_processes (
            agent_internal_id, agent_id, business_process_id, process_name, criticality,
            created_ts, updated_ts
        )
        SELECT
            agent_internal_id, agent_id, business_process_id, process_name, criticality,
            now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, business_process_id)
        DO UPDATE SET
            agent_id            = EXCLUDED.agent_id,
            process_name        = EXCLUDED.process_name,
            criticality         = EXCLUDED.criticality,
            updated_ts          = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(select_rows)} business processes ...")
    execute_dml(sql, label="agent_business_processes BULK INSERT ON CONFLICT")

    unique_ids = list(dict.fromkeys(process_ids))
    ids_sql = ", ".join(_sq(pid) for pid in unique_ids)
    cleanup_sql = f"""
        DELETE FROM core.agent_business_processes
        WHERE agent_internal_id = {_sq(agent_internal_id)}
          AND (business_process_id IS NULL OR business_process_id NOT IN ({ids_sql}))
    """
    execute_dml(cleanup_sql, label="agent_business_processes DELETE STALE RELATIONS")


def upsert_agent_business_applications(card: dict, agent_internal_id: str, now_str: str):
    ident        = card.get("identification", {})
    applications = card.get("application", []) or []
    if not has_meaningful_data(applications):
        print("Skipping application: all values are null/empty.")
        return

    agent_id    = ident.get("agent_id")
    select_rows = []
    application_ids = []

    for app in applications:
        business_application_id = _canonical_entity_id(app.get("identifier"), app.get("name"))
        if not business_application_id:
            continue
        application_ids.append(business_application_id)

        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}                AS agent_internal_id,
                {_sq(agent_id)}                         AS agent_id,
                {_sq(business_application_id)}          AS business_application_id,
                {_sq(app.get('name'))}                  AS application_name,
                {_sq(app.get('business_criticality'))}  AS criticality,
                TIMESTAMP '{now_str}'                   AS now_ts
        """.strip())

    if not select_rows:
        print("Skipping application: no application identifiers found.")
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_business_applications (
            agent_internal_id, agent_id, business_application_id, application_name, criticality,
            created_ts, updated_ts
        )
        SELECT
            agent_internal_id, agent_id, business_application_id, application_name, criticality,
            now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, business_application_id)
        DO UPDATE SET
            agent_id         = EXCLUDED.agent_id,
            application_name = EXCLUDED.application_name,
            criticality      = EXCLUDED.criticality,
            updated_ts       = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(select_rows)} business applications ...")
    execute_dml(sql, label="agent_business_applications BULK INSERT ON CONFLICT")

    unique_ids = list(dict.fromkeys(application_ids))
    ids_sql = ", ".join(_sq(app_id) for app_id in unique_ids)
    cleanup_sql = f"""
        DELETE FROM core.agent_business_applications
        WHERE agent_internal_id = {_sq(agent_internal_id)}
          AND (business_application_id IS NULL OR business_application_id NOT IN ({ids_sql}))
    """
    execute_dml(cleanup_sql, label="agent_business_applications DELETE STALE RELATIONS")

def upsert_agent_guardrail(card: dict, agent_internal_id: str, now_str: str):
    ident     = card.get("identification", {})
    guardrail = card.get("guardrail", {})
    if not has_meaningful_data(guardrail):
        print("Skipping guardrail: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_guardrails (
            agent_internal_id, agent_id, name, description, model,
            created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(guardrail.get('name'))}, {_sq(guardrail.get('description'))},
            {_sq(guardrail.get('model'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id    = EXCLUDED.agent_id,
            description = EXCLUDED.description,
            model       = EXCLUDED.model,
            updated_ts  = EXCLUDED.updated_ts
    """
    print(f"  Upserting guardrail for agent {agent_id} …")
    execute_dml(sql, label="agent_guardrails INSERT ON CONFLICT")


def upsert_agent_mcp_server(card: dict, agent_internal_id: str, now_str: str):
    ident      = card.get("identification", {})
    mcp_server = card.get("mcp_server", {})
    if not has_meaningful_data(mcp_server):
        print("Skipping mcp_server: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_mcp_servers (
            agent_internal_id, agent_id, name, url, version_number,
            last_updated_ts, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(mcp_server.get('name'))}, {_sq(mcp_server.get('url'))},
            {_sq(mcp_server.get('version_number'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id        = EXCLUDED.agent_id,
            name            = EXCLUDED.name,
            url             = EXCLUDED.url,
            version_number  = EXCLUDED.version_number,
            last_updated_ts = EXCLUDED.last_updated_ts,
            updated_ts      = EXCLUDED.updated_ts
    """
    print(f"  Upserting MCP server for agent {agent_id} …")
    execute_dml(sql, label="agent_mcp_servers INSERT ON CONFLICT")


def upsert_agent_memory(card: dict, agent_internal_id: str, now_str: str):
    ident  = card.get("identification", {})
    memory = card.get("memory", {})
    if not has_meaningful_data(memory):
        print("Skipping memory: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_memories (
            agent_internal_id, agent_id, identifier, name, type,
            created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(memory.get('identifier'))}, {_sq(memory.get('name'))},
            {_sq(memory.get('type'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id   = EXCLUDED.agent_id,
            identifier = EXCLUDED.identifier,
            name       = EXCLUDED.name,
            type       = EXCLUDED.type,
            updated_ts = EXCLUDED.updated_ts
    """
    print(f"  Upserting memory for agent {agent_id} …")
    execute_dml(sql, label="agent_memories INSERT ON CONFLICT")


def upsert_agent_physical_ai(card: dict, agent_internal_id: str, now_str: str):
    ident            = card.get("identification", {})
    physical_ai_list = card.get("physical_ai", []) or []
    if not has_meaningful_data(physical_ai_list):
        print("Skipping physical_ai: all values are null/empty.")
        return

    agent_id    = ident.get("agent_id")
    select_rows = []

    for pa in physical_ai_list:
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}             AS agent_internal_id,
                {_sq(agent_id)}                      AS agent_id,
                {_sq(pa.get('identifier'))}          AS identifier,
                {_sq(pa.get('name'))}                AS name,
                {_sq(pa.get('type'))}                AS type,
                {_sq(pa.get('sensory_input_source'))} AS sensory_input_source,
                TIMESTAMP '{now_str}'                AS now_ts
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    sql = f"""
        INSERT INTO core.agent_physical_ai (
            agent_internal_id, agent_id, identifier, name, type, sensory_input_source,
            created_ts, updated_ts
        )
        SELECT
            agent_internal_id, agent_id, identifier, name, type, sensory_input_source,
            now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id             = EXCLUDED.agent_id,
            identifier           = EXCLUDED.identifier,
            type                 = EXCLUDED.type,
            sensory_input_source = EXCLUDED.sensory_input_source,
            updated_ts           = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(physical_ai_list)} physical AI entries …")
    execute_dml(sql, label="agent_physical_ai BULK INSERT ON CONFLICT")


def upsert_agent_prompt_template(card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    template = card.get("prompt_template", {})
    if not has_meaningful_data(template):
        print("Skipping prompt_template: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_prompt_templates (
            agent_internal_id, agent_id, identifier, name, description,
            created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(template.get('identifier'))}, {_sq(template.get('name'))},
            {_sq(template.get('description'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id    = EXCLUDED.agent_id,
            identifier  = EXCLUDED.identifier,
            name        = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_ts  = EXCLUDED.updated_ts
    """
    print(f"  Upserting prompt template for agent {agent_id} …")
    execute_dml(sql, label="agent_prompt_templates INSERT ON CONFLICT")


def upsert_agent_regulation_or_framework(card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    reg   = card.get("regulation_or_framework", {})
    if not has_meaningful_data(reg):
        print("Skipping regulation_or_framework: all values are null/empty.")
        return

    agent_id = ident.get("agent_id")

    sql = f"""
        INSERT INTO core.agent_regulations_or_frameworks (
            agent_internal_id, agent_id,
            name, type, regulatory_authority, jurisdiction, requirement,
            created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(reg.get('name'))}, {_sq(reg.get('type'))},
            {_sq(reg.get('regulatory_authority'))}, {_sq(reg.get('jurisdiction'))},
            {_sq(reg.get('requirement'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id             = EXCLUDED.agent_id,
            name                 = EXCLUDED.name,
            type                 = EXCLUDED.type,
            regulatory_authority = EXCLUDED.regulatory_authority,
            jurisdiction         = EXCLUDED.jurisdiction,
            requirement          = EXCLUDED.requirement,
            updated_ts           = EXCLUDED.updated_ts
    """
    print(f"  Upserting regulation/framework for agent {agent_id} …")
    execute_dml(sql, label="agent_regulations_or_frameworks INSERT ON CONFLICT")


def upsert_agent_ai_models(card: dict, agent_internal_id: str, now_str: str):
    ident  = card.get("identification", {})
    models = card.get("ai_model", []) or []
    if not has_meaningful_data(models):
        print("Skipping ai_model: all values are null/empty.")
        return

    agent_id    = ident.get("agent_id")
    select_rows = []

    for model in models:
        # Deterministic catalog id derived from the model name so re-ingests and
        # multiple agents declaring the same model share one core.ai_models row.
        select_rows.append(f"""
            SELECT
                md5(lower(trim({_sq(model.get('name'))})))   AS ai_model_id,
                {_sq(agent_internal_id)}                      AS agent_internal_id,
                {_sq(agent_id)}                               AS agent_id,
                {_sq(model.get('name'))}                      AS model_name,
                {_sq(model.get('owner'))}                     AS owner,
                {_sq(model.get('department_executive'))}      AS department_executive,
                {_sq(model.get('description'))}               AS description,
                {_sq(model.get('model_provider') or model.get('provider'))} AS provider,
                {_sq(model.get('model_version') or model.get('version'))}   AS version_number,
                {_sq(model.get('model_type') or model.get('type'))}         AS model_type,
                TIMESTAMP '{now_str}'                         AS now_ts
            WHERE NULLIF(trim({_sq(model.get('name'))}), '') IS NOT NULL
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    # 1) Upsert the catalog (core.ai_models) with descriptive attributes.
    catalog_sql = f"""
        INSERT INTO core.ai_models (
            ai_model_id, model_name, owner, department_executive, description,
            provider, version_number, model_type, no_of_associated_agents,
            created_ts, updated_ts
        )
        SELECT
            ai_model_id, model_name, owner, department_executive, description,
            provider, version_number, model_type, 0, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (ai_model_id) DO UPDATE SET
            model_name           = COALESCE(NULLIF(EXCLUDED.model_name, ''), ai_models.model_name),
            owner                = COALESCE(EXCLUDED.owner, ai_models.owner),
            department_executive = COALESCE(EXCLUDED.department_executive, ai_models.department_executive),
            description          = COALESCE(EXCLUDED.description, ai_models.description),
            provider             = COALESCE(EXCLUDED.provider, ai_models.provider),
            version_number       = COALESCE(EXCLUDED.version_number, ai_models.version_number),
            model_type           = COALESCE(EXCLUDED.model_type, ai_models.model_type),
            updated_ts           = EXCLUDED.updated_ts
    """
    print(f"  Upserting {len(models)} AI models into catalog …")
    execute_dml(catalog_sql, label="ai_models catalog upsert")

    # 2) Upsert the agent<->model link (pure junction).
    link_sql = f"""
        INSERT INTO core.agent_ai_models (
            ai_model_id, model_name, agent_id, agent_internal_id, created_ts, updated_ts
        )
        SELECT ai_model_id, model_name, agent_id, agent_internal_id, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, ai_model_id)
        DO UPDATE SET
            model_name = EXCLUDED.model_name,
            agent_id   = EXCLUDED.agent_id,
            updated_ts = EXCLUDED.updated_ts
    """
    execute_dml(link_sql, label="agent_ai_models link upsert")


def upsert_agent_data_sources(card: dict, agent_internal_id: str, now_str: str):
    ident        = card.get("identification", {})
    data_sources = card.get("data_source", []) or []
    if not has_meaningful_data(data_sources):
        print("Skipping data_source: all values are null/empty.")
        return

    tenant_id = ident.get("tenant_id")
    agent_id = ident.get("agent_id")

    def _to_bool(val):
        if val is None:
            return "NULL"
        if isinstance(val, bool):
            return "TRUE" if val else "FALSE"
        return "TRUE" if str(val).strip().lower() in ("yes", "true") else "FALSE"

    # Python dedup — keyed on (agent_internal_id, source_object_id, target_object_id)
    unique = {}
    for ds in data_sources:
        key = (agent_internal_id, ds.get("source_object_id"), ds.get("target_object_id"))
        unique[key] = ds

    if len(unique) != len(data_sources):
        print(f"  ⚠ Removed {len(data_sources) - len(unique)} duplicate relationships before merge")

    data_sources = list(unique.values())
    select_rows  = []

    for ds in data_sources:
        select_rows.append(f"""
            SELECT
                {_sq(agent_internal_id)}                  AS agent_internal_id,
                {_sq(tenant_id)}                          AS tenant_id,
                {_sq(agent_id)}                           AS agent_id,
                {_sq(ds.get('access_level'))}             AS access_level,
                {_to_bool(ds.get('uses_pii'))}::boolean   AS contains_pii,
                {_to_bool(ds.get('uses_phi'))}::boolean   AS contains_phi,
                {_to_bool(ds.get('uses_pci'))}::boolean   AS contains_pci,
                TIMESTAMP '{now_str}'                     AS now_ts,
                {_sq(ds.get('relationship_id'))}          AS relationship_id,
                {_sq(ds.get('parent_relationship_id'))}   AS parent_relationship_id,
                {_sq(ds.get('source_object_id'))}         AS source_object_id,
                {_sq(ds.get('source_object_domain'))}     AS source_object_domain,
                {_sq(ds.get('source_object_name'))}       AS source_object_name,
                {_sq(ds.get('source_object_type'))}       AS source_object_type,
                {_sq(ds.get('target_object_id'))}         AS target_object_id,
                {_sq(ds.get('target_object_domain'))}     AS target_object_domain,
                {_sq(ds.get('target_object_name'))}       AS target_object_name,
                {_sq(ds.get('target_object_type'))}       AS target_object_type
        """.strip())

    union_all = "\nUNION ALL\n".join(select_rows)

    # ROW_NUMBER dedup in SQL (same as original Athena query)
    sql = f"""
        INSERT INTO core.agent_data_sources (
            agent_internal_id, tenant_id, agent_id,
            access_level, contains_pii, contains_phi, contains_pci,
            created_ts, updated_ts,
            relationship_id, parent_relationship_id,
            source_object_id, source_object_domain, source_object_name, source_object_type,
            target_object_id, target_object_domain, target_object_name, target_object_type
        )
        SELECT
            agent_internal_id, tenant_id, agent_id,
            access_level, contains_pii, contains_phi, contains_pci,
            now_ts, now_ts,
            relationship_id, parent_relationship_id,
            source_object_id, source_object_domain, source_object_name, source_object_type,
            target_object_id, target_object_domain, target_object_name, target_object_type
        FROM (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY agent_internal_id, source_object_name, target_object_name
                    ORDER BY now_ts DESC
                ) AS rn
            FROM ({union_all}) AS raw
        ) AS dedup
        WHERE rn = 1
        ON CONFLICT (agent_internal_id, source_object_id, target_object_id)
        DO UPDATE SET
            agent_id               = EXCLUDED.agent_id,
            access_level           = EXCLUDED.access_level,
            contains_pii           = EXCLUDED.contains_pii,
            contains_phi           = EXCLUDED.contains_phi,
            contains_pci           = EXCLUDED.contains_pci,
            updated_ts             = EXCLUDED.updated_ts,
            relationship_id        = EXCLUDED.relationship_id,
            parent_relationship_id = EXCLUDED.parent_relationship_id,
            source_object_domain   = EXCLUDED.source_object_domain,
            source_object_type     = EXCLUDED.source_object_type,
            target_object_domain   = EXCLUDED.target_object_domain,
            target_object_type     = EXCLUDED.target_object_type
    """
    print(f"  Upserting {len(data_sources)} unique data source relationships …")
    try:
        execute_dml(sql, label="agent_data_sources BULK INSERT ON CONFLICT")
        print(f"  ✅ Data sources upsert complete for agent {agent_id}")
    except Exception as e:
        print(f"  ❌ Data sources upsert failed for agent {agent_id}: {e}")
        raise


# ══════════════════════════════════════════════════════════════════════════════
# API DISPATCH  (unchanged)
# ══════════════════════════════════════════════════════════════════════════════

def dispatch_to_api(agent_internal_id: str, card: dict) -> bool:
    ident = card.get("identification", {})
    def _clean_required(value):
        if value is None:
            return ""
        return str(value).strip()

    agent_id = _clean_required(ident.get("agent_id"))
    agent_name = _clean_required(card.get("name"))
    agent_description = _clean_required(card.get("description"))
    card_tenant_id = _clean_required(ident.get("tenant_id")) or TENANT_ID or None

    missing = []
    if not _clean_required(agent_internal_id):
        missing.append("agent_internal_id")
    if not agent_id:
        missing.append("agent_id")
    if not agent_name:
        missing.append("agent_name")
    if not agent_description:
        missing.append("agent_description")

    if missing:
        print(f"  API dispatch skipped: missing required field(s): {', '.join(missing)}")
        return False

    payload = {
        "agent_internal_id": _clean_required(agent_internal_id),
        "agent_id": agent_id,
        "agent_name": agent_name,
        "agent_description": agent_description,
        "agent_instructions": _clean_required(ident.get("instruction")),
        "agent_role": _clean_required(ident.get("role")),
        "provider": "Agentic AI System Platform",
        "agent_platform": _clean_required(card.get("provider", {}).get("organization")),
        "tenant_id": card_tenant_id or "",
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
        "subsequent_system_availability_sa": "L"
    }

    agent_ref = (
        f"agent_internal_id={payload['agent_internal_id']}, "
        f"agent_id={payload['agent_id']}, "
        f"agent_name={payload['agent_name']}"
    )

    data = json.dumps(payload).encode("utf-8")
    try:
        req = urllib.request.Request(
            API_URL,
            data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = getattr(resp, "status", None)
            body = resp.read().decode("utf-8", errors="replace")
            print(f"  API dispatch success ({agent_ref}) -> {API_URL} [HTTP {status}]")
            if body:
                print(f"  API response body: {body}")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  API dispatch failed ({agent_ref}) -> {API_URL} [HTTP {e.code}]")
        if body:
            print(f"  API error body: {body}")
        return False
    except urllib.error.URLError as e:
        print(f"  API dispatch failed ({agent_ref}) -> {API_URL} [connection error: {e.reason}]")
        return False
    except Exception as e:
        print(f"  Failed to create API request object: {e}")
        return False


def dispatch_to_api_async(agent_internal_id: str, card: dict) -> bool:
    try:
        fut = _api_dispatch_pool.submit(dispatch_to_api, agent_internal_id, card)
        _api_dispatch_futures.append(fut)
        return True
    except Exception as e:
        print(f"  Failed to queue API dispatch: {e}")
        return False


def shutdown_api_dispatch_pool(wait_for_completion: bool):
    if wait_for_completion:
        pending = len(_api_dispatch_futures)
        print(f"[INFO] Waiting for {pending} queued API dispatch(es) to finish ...")
        for fut in _api_dispatch_futures:
            try:
                fut.result()
            except Exception as e:
                print(f"[WARN] Background API dispatch raised error: {e}")
        _api_dispatch_pool.shutdown(wait=True)
        print("[INFO] API dispatch queue drained.")
    else:
        _api_dispatch_pool.shutdown(wait=False)
        print("[INFO] API dispatch queue left running in background (fire-and-forget mode).")

# def _move(src: str, dest_folder: Path):
#     dest_folder.mkdir(parents=True, exist_ok=True)
#     dest = dest_folder / Path(src).name
#     if dest.exists():
#         ts   = datetime.now().strftime("%Y%m%dT%H%M%S%f")
#         dest = dest_folder / f"{Path(src).stem}_{ts}{Path(src).suffix}"
#     shutil.move(str(src), str(dest))
#     print(f"  Moved {Path(src).name} → {dest_folder.name}/")


# # ══════════════════════════════════════════════════════════════════════════════
# # CORE PROCESSOR  
# # ══════════════════════════════════════════════════════════════════════════════

def process_card(card_dict: dict):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
            json.dump(card_dict, tmp)
            tmp_path = tmp.name

        TavroAgentCard.from_json_file(tmp_path)
        os.remove(tmp_path)
        print("[INFO] AgentCard validation successful")
    except Exception as e:
        print(f"TavroAgentCard validation failed: {e}")
        return

    agent_id = card_dict.get("identification", {}).get("agent_id")
    if not agent_id:
        print("ERROR: missing identification.agent_id")
        return

    print(f"Processing agent_id={agent_id} …")

    incoming_source_hash = _hash(card_dict)
    print(f"Incoming source_hash={incoming_source_hash}")

    try:
        existing_source_hash = get_current_agent_source_hash(agent_id)
        print(f"Existing source_hash={existing_source_hash}")

        if existing_source_hash == incoming_source_hash:
            print(f"No changes detected for agent_id={agent_id}. Skipping.")
            return

        print("Change detected — proceeding with upserts.")
    except Exception as e:
        print(f"[WARN] source_hash check failed, continuing: {e}")

    try:
        print("[INFO] Step  1/21 - agents")
        agent_internal_id = upsert_agent(card_dict, now_str, incoming_source_hash)
    except Exception as e:
        print(f"[ERROR] upsert_agent failed: {e}")
        return

    steps = [
        ("[INFO] Step  2/21 - agent_configurations",              upsert_agent_configuration),
        ("[INFO] Step  3/21 - agent_identifications",             upsert_agent_identification),
        ("[INFO] Step  4/21 - agent_tools",                       upsert_agent_tools),
        ("[INFO] Step  5/21 - agent_controls",                    upsert_agent_controls),
        ("[INFO] Step  6/21 - agent_knowledge_sources",           upsert_agent_knowledge_source),
        ("[INFO] Step  7/21 - agent_llm_models",                  upsert_agent_llm_models),
        ("[INFO] Step  8/21 - agent_ai_use_cases",                upsert_agent_ai_use_cases),
        ("[INFO] Step  9/21 - business_processes",                upsert_business_processes),
        ("[INFO] Step 10/21 - business_applications",             upsert_business_applications),
        ("[INFO] Step 11/21 - agent_business_processes",          upsert_agent_business_processes),
        ("[INFO] Step 12/21 - agent_business_applications",       upsert_agent_business_applications),
        ("[INFO] Step 13/21 - agent_guardrails",                  upsert_agent_guardrail),
        ("[INFO] Step 14/21 - agent_mcp_servers",                 upsert_agent_mcp_server),
        ("[INFO] Step 15/21 - agent_memories",                    upsert_agent_memory),
        ("[INFO] Step 16/21 - agent_physical_ai",                 upsert_agent_physical_ai),
        ("[INFO] Step 17/21 - agent_prompt_templates",            upsert_agent_prompt_template),
        ("[INFO] Step 18/21 - agent_regulations_or_frameworks",   upsert_agent_regulation_or_framework),
        ("[INFO] Step 19/21 - agent_ai_models",                   upsert_agent_ai_models),
        ("[INFO] Step 20/21 - agent_data_sources",                upsert_agent_data_sources),
    ]

    for label, fn in steps:
        print(label)
        try:
            fn(card_dict, agent_internal_id, now_str)
        except Exception as e:
            print(f"[ERROR] {fn.__name__} failed: {e}")

    try:
        print("[INFO] Step 21/21 - dispatching to classify-risk API")
        if dispatch_to_api_async(agent_internal_id, card_dict):
            print("  ✓ API dispatch queued")
        else:
            print("  ✗ API dispatch queue failed")
    except Exception as e:
        print(f"[ERROR] Failed to dispatch to API: {e}")

    print("Done.")


def _iter_sample_cards(sample_dir: Path):
    for json_file in sorted(sample_dir.glob("*.json")):
        try:
            with json_file.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to parse {json_file.name}: {e}")
            continue

        if isinstance(payload, list):
            for idx, card in enumerate(payload, start=1):
                if isinstance(card, dict):
                    yield json_file, idx, card
                else:
                    print(f"[WARN] Skipping non-object item in {json_file.name} at index {idx}")
        elif isinstance(payload, dict):
            yield json_file, 1, payload
        else:
            print(f"[WARN] Skipping unsupported JSON type in {json_file.name}")


def load_sample_data():
    configured_path = os.getenv("DROP_DIR", "/app/sample-data")
    sample_dir = Path(configured_path)

    if not sample_dir.exists():
        fallback_dir = Path("./sample-data")
        if fallback_dir.exists():
            sample_dir = fallback_dir
        else:
            raise FileNotFoundError(
                f"Sample data folder not found at '{configured_path}' or '{fallback_dir.resolve()}'"
            )

    print(f"[INFO] Loading sample data from: {sample_dir.resolve()}")
    sample_files = sorted(sample_dir.glob("*.json"))
    if not sample_files:
        print("[WARN] No JSON files found. Nothing to load.")
        return

    processed_cards = 0
    for file_path, idx, card in _iter_sample_cards(sample_dir):
        print(f"\n[INFO] Processing {file_path.name} (record #{idx})")
        process_card(card)
        processed_cards += 1

    print(f"\n[INFO] Completed sample load. Total cards processed: {processed_cards}")


if __name__ == "__main__":
    init_pool()
    try:
        load_sample_data()
    finally:
        shutdown_api_dispatch_pool(wait_for_completion=WAIT_FOR_API_DISPATCH)
        close_pool()
