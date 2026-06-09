"""
upload_processor.py — Self-contained agent card processor for the API container.

This module is mounted at /app/services/upload_processor.py in the tavro-api container.
It replicates the 20-step upsert pipeline from worker.py using its own psycopg2
connection (POSTGRES_* env vars), adds tenant_id support, and refreshes the
curated.agent_360 snapshot after processing.

Risk assessment (Step 21) is intentionally omitted — uploaded agents must have
risk assessment triggered manually by the user.
"""

import os
import json
import hashlib
import tempfile
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool
from utils.db import db_connection as _db

CORE = os.getenv("CORE_DB_NAME", "core")


def _exec(conn, sql: str, label: str = "") -> None:
    with conn.cursor() as cur:
        cur.execute(sql)
    if label:
        print(f"  ✓ {label}")


def _query(conn, sql: str) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# SQL value helpers (mirrors worker.py)
# ---------------------------------------------------------------------------

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
    if not lst:
        return "ARRAY[]::text[]"
    items = ", ".join(f"'{str(i).replace(chr(39), chr(39)+chr(39))}'" for i in lst)
    return f"ARRAY[{items}]"


def _to_bool_ds(val) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    return "TRUE" if str(val).strip().lower() in ("yes", "true") else "FALSE"


def has_meaningful_data(data) -> bool:
    def is_meaningful(v):
        if v is None:
            return False
        if isinstance(v, str) and v.strip() == "":
            return False
        if isinstance(v, (list, dict)) and len(v) == 0:
            return False
        return True
    if isinstance(data, dict):
        return any(is_meaningful(v) for v in data.values())
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                if any(is_meaningful(v) for v in item.values()):
                    return True
            elif is_meaningful(item):
                return True
        return False
    return False


def _clean_text(value) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _canonical_entity_id(raw_id, raw_name) -> Optional[str]:
    return _clean_text(raw_id) or _clean_text(raw_name)


# ---------------------------------------------------------------------------
# Source-hash check
# ---------------------------------------------------------------------------

def _get_source_hash(conn, agent_id: str) -> Optional[str]:
    rows = _query(conn, f"""
        SELECT source_hash FROM {CORE}.agents
        WHERE agent_id = {_sq(agent_id)} AND is_current = true
        ORDER BY updated_ts DESC LIMIT 1
    """)
    return rows[0]["source_hash"] if rows else None


# ---------------------------------------------------------------------------
# Step 1 — core.agents  (with tenant_id)
# ---------------------------------------------------------------------------

def _upsert_agent(conn, card: dict, now_str: str, source_hash: str, tenant_id: Optional[str]) -> str:
    ident = card.get("identification", {})
    agent_id = ident.get("agent_id")
    incoming_internal_id = ident.get("agent_internal_id")

    row = {
        "agent_name":             card.get("name"),
        "agent_description":      card.get("description"),
        "protocol_version":       card.get("protocol_version"),
        "preferred_transport":    card.get("preferredTransport"),
        "supports_auth_ext_card": card.get("supports_authenticated_extended_card"),
        "card_version":           card.get("version"),
        "source_system":          card.get("provider", {}).get("organization"),
    }
    record_hash = _hash(row)

    rows = _query(conn, f"SELECT agent_internal_id FROM {CORE}.agents WHERE agent_id = {_sq(agent_id)} LIMIT 1")
    agent_internal_id = rows[0]["agent_internal_id"] if rows else incoming_internal_id

    _exec(conn, f"""
        INSERT INTO {CORE}.agents (
            tenant_id, agent_id, agent_internal_id, agent_name, agent_description,
            protocol_version, preferred_transport, supports_auth_ext_card,
            card_version, source_hash, source_system, record_hash,
            valid_from_ts, valid_to_ts, is_current, created_ts, updated_ts
        ) VALUES (
            {_sq(tenant_id)}, {_sq(agent_id)}, {_sq(agent_internal_id)},
            {_sq(row['agent_name'])}, {_sq(row['agent_description'])},
            {_sq(row['protocol_version'])}, {_sq(row['preferred_transport'])},
            {_bool(row['supports_auth_ext_card'])}, {_sq(row['card_version'])},
            {_sq(source_hash)}, {_sq(row['source_system'])}, {_sq(record_hash)},
            TIMESTAMP '{now_str}', NULL, true,
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_id, agent_name) WHERE is_current = true
        DO UPDATE SET
            tenant_id              = EXCLUDED.tenant_id,
            agent_internal_id      = EXCLUDED.agent_internal_id,
            agent_description      = EXCLUDED.agent_description,
            protocol_version       = EXCLUDED.protocol_version,
            preferred_transport    = EXCLUDED.preferred_transport,
            supports_auth_ext_card = EXCLUDED.supports_auth_ext_card,
            card_version           = EXCLUDED.card_version,
            source_hash            = EXCLUDED.source_hash,
            source_system          = EXCLUDED.source_system,
            record_hash            = EXCLUDED.record_hash,
            updated_ts             = EXCLUDED.updated_ts
    """, "agents upsert")
    return agent_internal_id


# ---------------------------------------------------------------------------
# Step 2 — core.agent_configurations
# ---------------------------------------------------------------------------

def _upsert_agent_configuration(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    cfg   = card.get("configuration", {})
    if not has_meaningful_data(cfg):
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
        "execution_mode":         execution_mode,
    }
    record_hash = _hash(row)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_configurations (
            agent_internal_id, agent_id,
            access_scope, memory_type, data_freshness_policy,
            autonomy_level, reasoning_model, human_in_the_loop_flag,
            execution_mode, record_hash,
            valid_from_ts, valid_to_ts, is_current, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(row['access_scope'])}, {_sq(row['memory_type'])},
            {_sq(row['data_freshness_policy'])}, {_sq(row['autonomy_level'])},
            {_sq(row['reasoning_model'])}, NULL,
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
            execution_mode         = EXCLUDED.execution_mode,
            record_hash            = EXCLUDED.record_hash,
            updated_ts             = EXCLUDED.updated_ts
    """, "agent_configurations upsert")


# ---------------------------------------------------------------------------
# Step 3 — core.agent_identifications
# ---------------------------------------------------------------------------

def _upsert_agent_identification(conn, card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    agent_id = ident.get("agent_id")
    tags_raw = ident.get("tags")
    tags     = tags_raw if isinstance(tags_raw, list) else []
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_identifications (
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
            agent_id          = EXCLUDED.agent_id,
            goal_orientation  = EXCLUDED.goal_orientation,
            role              = EXCLUDED.role,
            instruction       = EXCLUDED.instruction,
            owner             = EXCLUDED.owner,
            environment       = EXCLUDED.environment,
            tags              = EXCLUDED.tags,
            governance_status = EXCLUDED.governance_status,
            reviewer          = EXCLUDED.reviewer,
            cost_center       = EXCLUDED.cost_center,
            updated_ts        = EXCLUDED.updated_ts
    """, "agent_identifications upsert")


# ---------------------------------------------------------------------------
# Step 4 — core.agent_tools
# ---------------------------------------------------------------------------

def _upsert_agent_tools(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    tools = card.get("tool", []) or []
    if not has_meaningful_data(tools):
        return
    agent_id = ident.get("agent_id")
    select_rows = []
    for tool in tools:
        delegation_possible = (
            str(tool.get("delegation_possible")).lower() == "true"
            if tool.get("delegation_possible") is not None else None
        )
        select_rows.append(f"""
            SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
                   {_sq(tool.get('identifier'))} AS tool_id, {_sq(tool.get('name'))} AS tool_name,
                   {_sq(tool.get('description'))} AS tool_description,
                   {_bool(delegation_possible)}::boolean AS delegation_possible,
                   {_sq(tool.get('allowed_delegates'))} AS allowed_delegates,
                   {_sq(tool.get('input_schema'))} AS input_schema_json_text,
                   {_sq(tool.get('output_schema'))} AS output_schema_json_text,
                   {_sq(tool.get('default_value'))} AS default_config_json_text,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_tools (
            agent_internal_id, agent_id, tool_id, tool_name, tool_description,
            delegation_possible, allowed_delegates,
            input_schema_json_text, output_schema_json_text, default_config_json_text,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, tool_id, tool_name, tool_description,
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
    """, f"agent_tools upsert ({len(tools)} tools)")


# ---------------------------------------------------------------------------
# Step 5 — core.agent_controls
# ---------------------------------------------------------------------------

def _upsert_agent_controls(conn, card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    controls = card.get("control", []) or []
    if not has_meaningful_data(controls):
        return
    agent_id = ident.get("agent_id")
    select_rows = [f"""
        SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
               {_sq(c.get('identifier'))} AS identifier, {_sq(c.get('name'))} AS name,
               {_sq(c.get('objective'))} AS objective, {_sq(c.get('domain'))} AS domain,
               TIMESTAMP '{now_str}' AS now_ts
    """.strip() for c in controls]
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_controls (
            agent_internal_id, agent_id, identifier, name, objective, domain,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, identifier, name, objective, domain, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, identifier = EXCLUDED.identifier,
            objective = EXCLUDED.objective, domain = EXCLUDED.domain,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_controls upsert ({len(controls)} controls)")


# ---------------------------------------------------------------------------
# Step 6 — core.agent_knowledge_sources
# ---------------------------------------------------------------------------

def _upsert_agent_knowledge_source(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    ks    = card.get("knowledge_source", {}) or {}
    if not has_meaningful_data(ks):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_knowledge_sources (
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
            agent_id = EXCLUDED.agent_id, identifier = EXCLUDED.identifier,
            name = EXCLUDED.name, access_mechanism = EXCLUDED.access_mechanism,
            updated_ts = EXCLUDED.updated_ts
    """, "agent_knowledge_sources upsert")


# ---------------------------------------------------------------------------
# Step 7 — core.agent_llm_models
# ---------------------------------------------------------------------------

def _upsert_agent_llm_models(conn, card: dict, agent_internal_id: str, now_str: str):
    ident  = card.get("identification", {})
    models = card.get("llm_model", []) or []
    if not has_meaningful_data(models):
        return
    agent_id = ident.get("agent_id")
    select_rows = [f"""
        SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
               {_sq(m.get('name'))} AS name, {_sq(m.get('version'))} AS version_number,
               TIMESTAMP '{now_str}' AS now_ts
    """.strip() for m in models]
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_llm_models (
            agent_internal_id, agent_id, name, version_number, created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, name, version_number, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, version_number = EXCLUDED.version_number,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_llm_models upsert ({len(models)} models)")


# ---------------------------------------------------------------------------
# Step 8 — core.agent_ai_use_cases
# ---------------------------------------------------------------------------

def _upsert_agent_ai_use_cases(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    ai_use_cases = card.get("ai_use_case", []) or []
    if not has_meaningful_data(ai_use_cases):
        return

    tenant_id = ident.get("tenant_id") or ""
    agent_id = ident.get("agent_id")
    agent_name = ident.get("agent_name") or card.get("name")
    select_rows = []

    for uc in ai_use_cases:
        use_case_id = _clean_text(uc.get("identifier")) or _clean_text(uc.get("ai_use_case_id"))
        if not use_case_id:
            continue
        select_rows.append(f"""
            SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(tenant_id)} AS tenant_id,
                   {_sq(agent_id)} AS agent_id, {_sq(agent_name)} AS agent_name,
                   {_sq(use_case_id)} AS ai_use_case_id, {_sq(uc.get('name'))} AS ai_use_case_name,
                   {_sq(uc.get('description'))} AS description,
                   {_sq(uc.get('proposed_by'))} AS proposed_by, {_sq(uc.get('owner'))} AS owner,
                   {_sq(uc.get('business_function'))} AS function,
                   {_sq(uc.get('problem_statement'))} AS problem_statement,
                   {_sq(uc.get('expected_benefits'))} AS expected_benefits,
                   {_sq(uc.get('priority'))} AS priority, {_sq(uc.get('status'))} AS status,
                   NULLIF({_sq(uc.get('agent_risk_exposure_are'))}, '')::numeric(10,2) AS agent_risk_exposure_are,
                   NULLIF({_sq(uc.get('no_of_associated_agents'))}, '')::int AS no_of_associated_agents,
                   {_sq(uc.get('inherent_risk_classification'))} AS inherent_risk_classification,
                   {_sq(uc.get('residual_risk_classification'))} AS residual_risk_classification,
                   {_sq(uc.get('agent_risk_tier_art'))} AS agent_risk_tier_art,
                   NULLIF({_sq(uc.get('blended_risk_score'))}, '')::numeric(10,2) AS blended_risk_score,
                   NULLIF({_sq(uc.get('inherent_risk_classification_score'))}, '')::numeric(10,2) AS inherent_risk_classification_score,
                   NULLIF({_sq(uc.get('residual_risk_classification_score'))}, '')::numeric(10,2) AS residual_risk_classification_score,
                   {_sq(uc.get('solution_approach'))} AS solution_approach,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())

    if not select_rows:
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    _exec(conn, f"""
        INSERT INTO {CORE}.ai_use_cases (
            tenant_id, ai_use_case_id, name, description, proposed_by, owner, function,
            problem_statement, expected_benefits, priority, status, agent_internal_id,
            agent_risk_exposure_are, no_of_associated_agents, inherent_risk_classification,
            residual_risk_classification, agent_risk_tier_art, blended_risk_score,
            inherent_risk_classification_score, residual_risk_classification_score,
            solution_approach, created_ts, updated_ts
        )
        SELECT tenant_id, ai_use_case_id, ai_use_case_name, description, proposed_by, owner, function,
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
    """, f"ai_use_cases upsert ({len(select_rows)})")

    _exec(conn, f"""
        INSERT INTO {CORE}.agent_ai_use_cases (
            tenant_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts
        )
        SELECT tenant_id, ai_use_case_id, ai_use_case_name, agent_id, agent_name, agent_internal_id, now_ts, now_ts
        FROM ({union_all}) AS s
        WHERE agent_id IS NOT NULL AND agent_id <> ''
        ON CONFLICT (tenant_id, ai_use_case_id, agent_id)
        DO UPDATE SET
            ai_use_case_name = EXCLUDED.ai_use_case_name,
            agent_name = EXCLUDED.agent_name,
            agent_internal_id = EXCLUDED.agent_internal_id,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_ai_use_cases upsert ({len(select_rows)})")

    _exec(conn, f"""
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
            LEFT JOIN {CORE}.agent_ai_use_cases rel
              ON rel.ai_use_case_id = a.ai_use_case_id
             AND COALESCE(rel.tenant_id, '') = COALESCE(a.tenant_id, '')
             AND rel.agent_id IS NOT NULL
             AND rel.agent_id <> ''
            GROUP BY a.tenant_id, a.ai_use_case_id
        )
        UPDATE {CORE}.ai_use_cases uc
        SET
            no_of_associated_agents = c.associated_count,
            updated_ts = TIMESTAMP '{now_str}'
        FROM counts c
        WHERE uc.ai_use_case_id = c.ai_use_case_id
          AND COALESCE(uc.tenant_id, '') = COALESCE(c.tenant_id, '')
    """, f"ai_use_cases associated-count sync ({len(select_rows)})")


# Step 8b — core.agent_skills (many-to-many relationship with skills)
# ---------------------------------------------------------------------------

def _upsert_agent_skills(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    skills = card.get("skills", []) or []
    if not has_meaningful_data(skills):
        return

    tenant_id = ident.get("tenant_id")
    if not tenant_id:
        rows = _query(conn, f"SELECT tenant_id FROM {CORE}.agents WHERE agent_internal_id = {_sq(agent_internal_id)} LIMIT 1")
        if rows and rows[0].get("tenant_id"):
            tenant_id = rows[0].get("tenant_id")
    tenant_id = tenant_id or ""
    agent_id = ident.get("agent_id")
    agent_name = ident.get("agent_name") or card.get("name")
    select_rows = []
    seen_skill_ids = set()

    for skill in skills:
        if isinstance(skill, str):
            skill_id = _clean_text(skill)
            skill_name = skill_id
            description = None
            tags = []
            input_modes = []
            output_modes = []
        elif isinstance(skill, dict):
            skill_id = (
                _clean_text(skill.get("identifier"))
                or _clean_text(skill.get("skill_id"))
                or _clean_text(skill.get("id"))
                or _clean_text(skill.get("name"))
            )
            skill_name = (
                _clean_text(skill.get("name"))
                or _clean_text(skill.get("skill_name"))
                or _clean_text(skill.get("id"))
                or skill_id
            )
            description = _clean_text(skill.get("description"))
            tags = skill.get("tags") if isinstance(skill.get("tags"), list) else []
            input_modes = skill.get("inputModes") or skill.get("input_modes") or []
            output_modes = skill.get("outputModes") or skill.get("output_modes") or []
            input_modes = input_modes if isinstance(input_modes, list) else []
            output_modes = output_modes if isinstance(output_modes, list) else []
        else:
            continue

        if not skill_id:
            continue
        skill_key = skill_id.strip().lower()
        if skill_key in seen_skill_ids:
            continue
        seen_skill_ids.add(skill_key)

        select_rows.append(f"""
            SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(tenant_id)} AS tenant_id,
                   {_sq(agent_id)} AS agent_id, {_sq(agent_name)} AS agent_name,
                   {_sq(skill_id)} AS skill_id, {_sq(skill_name)} AS skill_name,
                   {_sq(description)} AS description,
                   {_array_str(tags)} AS tags,
                   {_array_str(input_modes)} AS input_modes,
                   {_array_str(output_modes)} AS output_modes,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())

    if not select_rows:
        return

    union_all = "\nUNION ALL\n".join(select_rows)

    # Upsert master skills table
    _exec(conn, f"""
        INSERT INTO {CORE}.skills (
            tenant_id, skill_id, name, description,
            tags, input_modes, output_modes,
            created_ts, updated_ts
        )
        SELECT DISTINCT tenant_id, skill_id, skill_name, description,
               tags, input_modes, output_modes,
               now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (tenant_id, skill_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            tags = EXCLUDED.tags,
            input_modes = EXCLUDED.input_modes,
            output_modes = EXCLUDED.output_modes,
            updated_ts = EXCLUDED.updated_ts
    """, f"skills upsert ({len(select_rows)})")

    # Upsert junction table (many-to-many)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_skills (
            tenant_id, skill_id, skill_name, agent_id, agent_name, agent_internal_id, created_ts, updated_ts
        )
        SELECT tenant_id, skill_id, skill_name, agent_id, agent_name, agent_internal_id, now_ts, now_ts
        FROM ({union_all}) AS s
        WHERE agent_id IS NOT NULL AND agent_id <> ''
        ON CONFLICT (tenant_id, skill_id, agent_id)
        DO UPDATE SET
            skill_name = EXCLUDED.skill_name,
            agent_name = EXCLUDED.agent_name,
            agent_internal_id = EXCLUDED.agent_internal_id,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_skills upsert ({len(select_rows)})")


# ---------------------------------------------------------------------------
# Step 9 — core.business_processes
# ---------------------------------------------------------------------------

def _upsert_business_processes(conn, card: dict, agent_internal_id: str, now_str: str):
    processes = card.get("business_process", []) or []
    if not has_meaningful_data(processes):
        return

    select_rows = []
    inserted_ids = set()
    referenced_ids = set()

    for proc in processes:
        bp_id = _canonical_entity_id(proc.get("identifier"), proc.get("name"))
        if not bp_id or bp_id in inserted_ids:
            continue
        inserted_ids.add(bp_id)
        referenced_ids.add(bp_id)
        parent_id = _canonical_entity_id(proc.get("parent_process_id"), proc.get("parent_process_name"))
        if parent_id:
            referenced_ids.add(parent_id)
        process_number = _clean_text(proc.get("process_number")) or bp_id
        select_rows.append(f"""
            SELECT {_sq(bp_id)} AS business_process_id, {_sq(process_number)} AS process_number,
                   {_sq(proc.get('name'))} AS process_name, {_sq(proc.get('description'))} AS process_description,
                   {_sq(parent_id)} AS parent_process_id,
                   {_sq(proc.get('business_criticality'))} AS business_criticality,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())

    if not select_rows:
        return

    seed_rows = "\nUNION ALL\n".join(
        f"SELECT {_sq(pid)} AS business_process_id, TIMESTAMP '{now_str}' AS now_ts"
        for pid in sorted(referenced_ids)
    )
    _exec(conn, f"""
        INSERT INTO {CORE}.business_processes (business_process_id, process_number, created_ts, updated_ts)
        SELECT business_process_id, business_process_id, now_ts, now_ts FROM ({seed_rows}) AS seed
        ON CONFLICT (business_process_id) DO UPDATE SET updated_ts = EXCLUDED.updated_ts
    """, "business_processes seed")

    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.business_processes (
            business_process_id, process_number, process_name, process_description,
            parent_process_id, business_criticality, created_ts, updated_ts
        )
        SELECT business_process_id, process_number, process_name, process_description,
               parent_process_id, business_criticality, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (business_process_id)
        DO UPDATE SET
            process_number = COALESCE(EXCLUDED.process_number, {CORE}.business_processes.process_number),
            process_name = COALESCE(EXCLUDED.process_name, {CORE}.business_processes.process_name),
            process_description = COALESCE(EXCLUDED.process_description, {CORE}.business_processes.process_description),
            parent_process_id = COALESCE(EXCLUDED.parent_process_id, {CORE}.business_processes.parent_process_id),
            business_criticality = COALESCE(EXCLUDED.business_criticality, {CORE}.business_processes.business_criticality),
            updated_ts = EXCLUDED.updated_ts
    """, f"business_processes upsert ({len(select_rows)})")


# ---------------------------------------------------------------------------
# Step 10 — core.business_applications
# ---------------------------------------------------------------------------

def _upsert_business_applications(conn, card: dict, agent_internal_id: str, now_str: str):
    applications = card.get("application", []) or []
    if not has_meaningful_data(applications):
        return

    select_rows = []
    inserted_ids = set()
    for app in applications:
        app_id = _canonical_entity_id(app.get("identifier"), app.get("name"))
        if not app_id or app_id in inserted_ids:
            continue
        inserted_ids.add(app_id)
        select_rows.append(f"""
            SELECT {_sq(app_id)} AS business_application_id, {_sq(app.get('name'))} AS application_name,
                   {_sq(app.get('business_criticality'))} AS business_criticality,
                   {_sq(app.get('emergency_tier'))} AS emergency_tier,
                   {_sq(app.get('description'))} AS application_description,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())

    if not select_rows:
        return
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.business_applications (
            business_application_id, application_name, business_criticality,
            emergency_tier, application_description, created_ts, updated_ts
        )
        SELECT business_application_id, application_name, business_criticality,
               emergency_tier, application_description, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (business_application_id)
        DO UPDATE SET
            application_name = COALESCE(EXCLUDED.application_name, {CORE}.business_applications.application_name),
            business_criticality = COALESCE(EXCLUDED.business_criticality, {CORE}.business_applications.business_criticality),
            emergency_tier = COALESCE(EXCLUDED.emergency_tier, {CORE}.business_applications.emergency_tier),
            application_description = COALESCE(EXCLUDED.application_description, {CORE}.business_applications.application_description),
            updated_ts = EXCLUDED.updated_ts
    """, f"business_applications upsert ({len(select_rows)})")


# ---------------------------------------------------------------------------
# Step 11 — core.agent_business_processes
# ---------------------------------------------------------------------------

def _upsert_agent_business_processes(conn, card: dict, agent_internal_id: str, now_str: str):
    ident     = card.get("identification", {})
    processes = card.get("business_process", []) or []
    if not has_meaningful_data(processes):
        return
    agent_id    = ident.get("agent_id")
    select_rows = []
    process_ids = []
    for proc in processes:
        bp_id = _canonical_entity_id(proc.get("identifier"), proc.get("name"))
        if not bp_id:
            continue
        process_ids.append(bp_id)
        select_rows.append(f"""
            SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
                   {_sq(bp_id)} AS business_process_id, {_sq(proc.get('name'))} AS process_name,
                   {_sq(proc.get('business_criticality'))} AS criticality,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())
    if not select_rows:
        return
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_business_processes (
            agent_internal_id, agent_id, business_process_id, process_name, criticality,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, business_process_id, process_name, criticality, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, business_process_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, process_name = EXCLUDED.process_name,
            criticality = EXCLUDED.criticality, updated_ts = EXCLUDED.updated_ts
    """, f"agent_business_processes upsert ({len(select_rows)})")
    if process_ids:
        unique_ids = list(dict.fromkeys(process_ids))
        ids_sql = ", ".join(_sq(pid) for pid in unique_ids)
        _exec(conn, f"""
            DELETE FROM {CORE}.agent_business_processes
            WHERE agent_internal_id = {_sq(agent_internal_id)}
              AND (business_process_id IS NULL OR business_process_id NOT IN ({ids_sql}))
        """, "agent_business_processes cleanup")


# ---------------------------------------------------------------------------
# Step 12 — core.agent_business_applications
# ---------------------------------------------------------------------------

def _upsert_agent_business_applications(conn, card: dict, agent_internal_id: str, now_str: str):
    ident        = card.get("identification", {})
    applications = card.get("application", []) or []
    if not has_meaningful_data(applications):
        return
    agent_id        = ident.get("agent_id")
    select_rows     = []
    application_ids = []
    for app in applications:
        app_id = _canonical_entity_id(app.get("identifier"), app.get("name"))
        if not app_id:
            continue
        application_ids.append(app_id)
        select_rows.append(f"""
            SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
                   {_sq(app_id)} AS business_application_id, {_sq(app.get('name'))} AS application_name,
                   {_sq(app.get('business_criticality'))} AS criticality,
                   TIMESTAMP '{now_str}' AS now_ts
        """.strip())
    if not select_rows:
        return
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_business_applications (
            agent_internal_id, agent_id, business_application_id, application_name, criticality,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, business_application_id, application_name, criticality, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, business_application_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, application_name = EXCLUDED.application_name,
            criticality = EXCLUDED.criticality, updated_ts = EXCLUDED.updated_ts
    """, f"agent_business_applications upsert ({len(select_rows)})")
    if application_ids:
        unique_ids = list(dict.fromkeys(application_ids))
        ids_sql = ", ".join(_sq(a) for a in unique_ids)
        _exec(conn, f"""
            DELETE FROM {CORE}.agent_business_applications
            WHERE agent_internal_id = {_sq(agent_internal_id)}
              AND (business_application_id IS NULL OR business_application_id NOT IN ({ids_sql}))
        """, "agent_business_applications cleanup")


# ---------------------------------------------------------------------------
# Step 13 — core.agent_guardrails
# ---------------------------------------------------------------------------

def _upsert_agent_guardrail(conn, card: dict, agent_internal_id: str, now_str: str):
    ident     = card.get("identification", {})
    guardrail = card.get("guardrail", {})
    if not has_meaningful_data(guardrail):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_guardrails (
            agent_internal_id, agent_id, name, description, model, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(guardrail.get('name'))}, {_sq(guardrail.get('description'))},
            {_sq(guardrail.get('model'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, description = EXCLUDED.description,
            model = EXCLUDED.model, updated_ts = EXCLUDED.updated_ts
    """, "agent_guardrails upsert")


# ---------------------------------------------------------------------------
# Step 14 — core.agent_mcp_servers
# ---------------------------------------------------------------------------

def _upsert_agent_mcp_server(conn, card: dict, agent_internal_id: str, now_str: str):
    ident      = card.get("identification", {})
    mcp_server = card.get("mcp_server", {})
    if not has_meaningful_data(mcp_server):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_mcp_servers (
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
            agent_id = EXCLUDED.agent_id, name = EXCLUDED.name, url = EXCLUDED.url,
            version_number = EXCLUDED.version_number, last_updated_ts = EXCLUDED.last_updated_ts,
            updated_ts = EXCLUDED.updated_ts
    """, "agent_mcp_servers upsert")


# ---------------------------------------------------------------------------
# Step 15 — core.agent_memories
# ---------------------------------------------------------------------------

def _upsert_agent_memory(conn, card: dict, agent_internal_id: str, now_str: str):
    ident  = card.get("identification", {})
    memory = card.get("memory", {})
    if not has_meaningful_data(memory):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_memories (
            agent_internal_id, agent_id, identifier, name, type, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(memory.get('identifier'))}, {_sq(memory.get('name'))},
            {_sq(memory.get('type'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, identifier = EXCLUDED.identifier,
            name = EXCLUDED.name, type = EXCLUDED.type, updated_ts = EXCLUDED.updated_ts
    """, "agent_memories upsert")


# ---------------------------------------------------------------------------
# Step 16 — core.agent_physical_ai
# ---------------------------------------------------------------------------

def _upsert_agent_physical_ai(conn, card: dict, agent_internal_id: str, now_str: str):
    ident            = card.get("identification", {})
    physical_ai_list = card.get("physical_ai", []) or []
    if not has_meaningful_data(physical_ai_list):
        return
    agent_id = ident.get("agent_id")
    select_rows = [f"""
        SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
               {_sq(pa.get('identifier'))} AS identifier, {_sq(pa.get('name'))} AS name,
               {_sq(pa.get('type'))} AS type, {_sq(pa.get('sensory_input_source'))} AS sensory_input_source,
               TIMESTAMP '{now_str}' AS now_ts
    """.strip() for pa in physical_ai_list]
    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_physical_ai (
            agent_internal_id, agent_id, identifier, name, type, sensory_input_source,
            created_ts, updated_ts
        )
        SELECT agent_internal_id, agent_id, identifier, name, type, sensory_input_source, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, name)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, identifier = EXCLUDED.identifier,
            type = EXCLUDED.type, sensory_input_source = EXCLUDED.sensory_input_source,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_physical_ai upsert ({len(physical_ai_list)})")


# ---------------------------------------------------------------------------
# Step 17 — core.agent_prompt_templates
# ---------------------------------------------------------------------------

def _upsert_agent_prompt_template(conn, card: dict, agent_internal_id: str, now_str: str):
    ident    = card.get("identification", {})
    template = card.get("prompt_template", {})
    if not has_meaningful_data(template):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_prompt_templates (
            agent_internal_id, agent_id, identifier, name, description, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(template.get('identifier'))}, {_sq(template.get('name'))},
            {_sq(template.get('description'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, identifier = EXCLUDED.identifier,
            name = EXCLUDED.name, description = EXCLUDED.description, updated_ts = EXCLUDED.updated_ts
    """, "agent_prompt_templates upsert")


# ---------------------------------------------------------------------------
# Step 18 — core.agent_regulations_or_frameworks
# ---------------------------------------------------------------------------

def _upsert_agent_regulation_or_framework(conn, card: dict, agent_internal_id: str, now_str: str):
    ident = card.get("identification", {})
    reg   = card.get("regulation_or_framework", {})
    if not has_meaningful_data(reg):
        return
    agent_id = ident.get("agent_id")
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_regulations_or_frameworks (
            agent_internal_id, agent_id, name, type, regulatory_authority, jurisdiction,
            requirement, created_ts, updated_ts
        ) VALUES (
            {_sq(agent_internal_id)}, {_sq(agent_id)},
            {_sq(reg.get('name'))}, {_sq(reg.get('type'))},
            {_sq(reg.get('regulatory_authority'))}, {_sq(reg.get('jurisdiction'))},
            {_sq(reg.get('requirement'))},
            TIMESTAMP '{now_str}', TIMESTAMP '{now_str}'
        )
        ON CONFLICT (agent_internal_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, name = EXCLUDED.name, type = EXCLUDED.type,
            regulatory_authority = EXCLUDED.regulatory_authority, jurisdiction = EXCLUDED.jurisdiction,
            requirement = EXCLUDED.requirement, updated_ts = EXCLUDED.updated_ts
    """, "agent_regulations_or_frameworks upsert")


# ---------------------------------------------------------------------------
# Step 19 — core.agent_ai_models
# ---------------------------------------------------------------------------

def _upsert_agent_ai_models(conn, card: dict, agent_internal_id: str, now_str: str):
    ident  = card.get("identification", {})
    models = card.get("ai_model", []) or []
    if not has_meaningful_data(models):
        return
    agent_id = ident.get("agent_id")
    # Deterministic catalog id from model name (shared core.ai_models row across
    # re-ingests and agents). Descriptive attributes go to the catalog; the
    # junction holds only the link.
    select_rows = [f"""
        SELECT md5(lower(trim({_sq(m.get('name'))}))) AS ai_model_id,
               {_sq(agent_internal_id)} AS agent_internal_id, {_sq(agent_id)} AS agent_id,
               {_sq(m.get('name'))} AS model_name, {_sq(m.get('owner'))} AS owner,
               {_sq(m.get('department_executive'))} AS department_executive,
               {_sq(m.get('description'))} AS description,
               {_sq(m.get('model_provider') or m.get('provider'))} AS provider,
               {_sq(m.get('model_version') or m.get('version'))} AS version_number,
               {_sq(m.get('model_type') or m.get('type'))} AS model_type,
               TIMESTAMP '{now_str}' AS now_ts
        WHERE NULLIF(trim({_sq(m.get('name'))}), '') IS NOT NULL
    """.strip() for m in models]
    union_all = "\nUNION ALL\n".join(select_rows)
    # 1) Catalog upsert.
    _exec(conn, f"""
        INSERT INTO {CORE}.ai_models (
            ai_model_id, model_name, owner, department_executive, description,
            provider, version_number, model_type, no_of_associated_agents, created_ts, updated_ts
        )
        SELECT ai_model_id, model_name, owner, department_executive, description,
               provider, version_number, model_type, 0, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (ai_model_id) DO UPDATE SET
            model_name           = COALESCE(NULLIF(EXCLUDED.model_name, ''), {CORE}.ai_models.model_name),
            owner                = COALESCE(EXCLUDED.owner, {CORE}.ai_models.owner),
            department_executive = COALESCE(EXCLUDED.department_executive, {CORE}.ai_models.department_executive),
            description          = COALESCE(EXCLUDED.description, {CORE}.ai_models.description),
            provider             = COALESCE(EXCLUDED.provider, {CORE}.ai_models.provider),
            version_number       = COALESCE(EXCLUDED.version_number, {CORE}.ai_models.version_number),
            model_type           = COALESCE(EXCLUDED.model_type, {CORE}.ai_models.model_type),
            updated_ts           = EXCLUDED.updated_ts
    """, f"ai_models catalog upsert ({len(models)})")
    # 2) Junction link upsert.
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_ai_models (
            ai_model_id, model_name, agent_id, agent_internal_id, created_ts, updated_ts
        )
        SELECT ai_model_id, model_name, agent_id, agent_internal_id, now_ts, now_ts
        FROM ({union_all}) AS s
        ON CONFLICT (agent_internal_id, ai_model_id)
        DO UPDATE SET
            model_name = EXCLUDED.model_name, agent_id = EXCLUDED.agent_id,
            updated_ts = EXCLUDED.updated_ts
    """, f"agent_ai_models link upsert ({len(models)})")


# ---------------------------------------------------------------------------
# Step 20 — core.agent_data_sources
# ---------------------------------------------------------------------------

def _upsert_agent_data_sources(conn, card: dict, agent_internal_id: str, now_str: str):
    ident        = card.get("identification", {})
    data_sources = card.get("data_source", []) or []
    if not has_meaningful_data(data_sources):
        return
    tenant_id = ident.get("tenant_id")
    agent_id  = ident.get("agent_id")

    unique = {}
    for ds in data_sources:
        key = (agent_internal_id, ds.get("source_object_id"), ds.get("target_object_id"))
        unique[key] = ds
    data_sources = list(unique.values())

    select_rows = [f"""
        SELECT {_sq(agent_internal_id)} AS agent_internal_id, {_sq(tenant_id)} AS tenant_id,
               {_sq(agent_id)} AS agent_id, {_sq(ds.get('access_level'))} AS access_level,
               {_to_bool_ds(ds.get('uses_pii'))}::boolean AS contains_pii,
               {_to_bool_ds(ds.get('uses_phi'))}::boolean AS contains_phi,
               {_to_bool_ds(ds.get('uses_pci'))}::boolean AS contains_pci,
               TIMESTAMP '{now_str}' AS now_ts,
               {_sq(ds.get('relationship_id'))} AS relationship_id,
               {_sq(ds.get('parent_relationship_id'))} AS parent_relationship_id,
               {_sq(ds.get('source_object_id'))} AS source_object_id,
               {_sq(ds.get('source_object_domain'))} AS source_object_domain,
               {_sq(ds.get('source_object_name'))} AS source_object_name,
               {_sq(ds.get('source_object_type'))} AS source_object_type,
               {_sq(ds.get('target_object_id'))} AS target_object_id,
               {_sq(ds.get('target_object_domain'))} AS target_object_domain,
               {_sq(ds.get('target_object_name'))} AS target_object_name,
               {_sq(ds.get('target_object_type'))} AS target_object_type
    """.strip() for ds in data_sources]

    union_all = "\nUNION ALL\n".join(select_rows)
    _exec(conn, f"""
        INSERT INTO {CORE}.agent_data_sources (
            agent_internal_id, tenant_id, agent_id,
            access_level, contains_pii, contains_phi, contains_pci,
            created_ts, updated_ts,
            relationship_id, parent_relationship_id,
            source_object_id, source_object_domain, source_object_name, source_object_type,
            target_object_id, target_object_domain, target_object_name, target_object_type
        )
        SELECT agent_internal_id, tenant_id, agent_id,
               access_level, contains_pii, contains_phi, contains_pci, now_ts, now_ts,
               relationship_id, parent_relationship_id,
               source_object_id, source_object_domain, source_object_name, source_object_type,
               target_object_id, target_object_domain, target_object_name, target_object_type
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY agent_internal_id, source_object_name, target_object_name
                ORDER BY now_ts DESC
            ) AS rn
            FROM ({union_all}) AS raw
        ) AS dedup WHERE rn = 1
        ON CONFLICT (agent_internal_id, source_object_id, target_object_id)
        DO UPDATE SET
            agent_id = EXCLUDED.agent_id, access_level = EXCLUDED.access_level,
            contains_pii = EXCLUDED.contains_pii, contains_phi = EXCLUDED.contains_phi,
            contains_pci = EXCLUDED.contains_pci, updated_ts = EXCLUDED.updated_ts,
            relationship_id = EXCLUDED.relationship_id,
            parent_relationship_id = EXCLUDED.parent_relationship_id,
            source_object_domain = EXCLUDED.source_object_domain,
            source_object_type = EXCLUDED.source_object_type,
            target_object_domain = EXCLUDED.target_object_domain,
            target_object_type = EXCLUDED.target_object_type
    """, f"agent_data_sources upsert ({len(data_sources)})")


# ---------------------------------------------------------------------------
# Card validation  (mirrors worker.py Step 0)
# ---------------------------------------------------------------------------

def _validate_agent_card(card_dict: dict) -> tuple:
    """Validate the card against the TavroAgentCard schema before any DB writes.

    Returns (True, '') on success, or (False, error_message) on failure.
    """
    tmp_path = None
    try:
        from tavro_agent_card import TavroAgentCard
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(card_dict, tmp)
            tmp_path = tmp.name
        TavroAgentCard.from_json_file(tmp_path)
        print("[INFO] AgentCard validation successful")
        return True, ""
    except Exception as e:
        msg = str(e)
        print(f"[ERROR] TavroAgentCard validation failed: {msg}")
        return False, msg
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def process_card_for_upload(card_dict: dict, tenant_id: Optional[str] = None) -> bool:
    """
    Process a single agent card from an uploaded JSON file.

    Validates the card against TavroAgentCard schema first, then runs all 20
    upsert steps (identical pipeline to worker.py) without triggering risk
    assessment. The tenant_id from the uploading user is stored in core.agents
    so the agent is scoped to their tenant in the catalog.

    Args:
        card_dict: Parsed agent card dictionary.
        tenant_id: Tenant ID from the uploading user (x-tenant-id header).

    Returns:
        True on success or no-op, False on validation/fatal error.
    """
    valid, _ = _validate_agent_card(card_dict)
    if not valid:
        raise ValueError("Invalid")

    now_str  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    agent_id = card_dict.get("identification", {}).get("agent_id")
    if not agent_id:
        print("[ERROR] Missing identification.agent_id — skipping card")
        return False

    print(f"[INFO] Processing uploaded agent_id={agent_id} …")
    incoming_source_hash = _hash(card_dict)

    try:
        with _db() as conn:
            existing_hash = _get_source_hash(conn, agent_id)
            if existing_hash == incoming_source_hash:
                print(f"[INFO] No changes detected for agent_id={agent_id}. Skipping.")
                return True
    except Exception as e:
        print(f"[WARN] source_hash check failed, continuing: {e}")

    try:
        with _db() as conn:
            print("[INFO] Step  1/20 - agents")
            agent_internal_id = _upsert_agent(conn, card_dict, now_str, incoming_source_hash, tenant_id)
            if tenant_id is not None:
                ident = card_dict.setdefault("identification", {})
                ident["tenant_id"] = tenant_id

            steps = [
                (" 2/20 - agent_configurations",            _upsert_agent_configuration),
                (" 3/20 - agent_identifications",           _upsert_agent_identification),
                (" 4/20 - agent_tools",                     _upsert_agent_tools),
                (" 5/20 - agent_controls",                  _upsert_agent_controls),
                (" 6/20 - agent_knowledge_sources",         _upsert_agent_knowledge_source),
                (" 7/20 - agent_llm_models",                _upsert_agent_llm_models),
                (" 8/20 - agent_ai_use_cases",              _upsert_agent_ai_use_cases),
                (" 8b/20 - agent_skills",                   _upsert_agent_skills),
                (" 9/20 - business_processes",              _upsert_business_processes),
                ("10/20 - business_applications",           _upsert_business_applications),
                ("11/20 - agent_business_processes",        _upsert_agent_business_processes),
                ("12/20 - agent_business_applications",     _upsert_agent_business_applications),
                ("13/20 - agent_guardrails",                _upsert_agent_guardrail),
                ("14/20 - agent_mcp_servers",               _upsert_agent_mcp_server),
                ("15/20 - agent_memories",                  _upsert_agent_memory),
                ("16/20 - agent_physical_ai",               _upsert_agent_physical_ai),
                ("17/20 - agent_prompt_templates",          _upsert_agent_prompt_template),
                ("18/20 - agent_regulations_or_frameworks", _upsert_agent_regulation_or_framework),
                ("19/20 - agent_ai_models",                 _upsert_agent_ai_models),
                ("20/20 - agent_data_sources",              _upsert_agent_data_sources),
            ]
            for label, fn in steps:
                print(f"[INFO] Step {label}")
                try:
                    fn(conn, card_dict, agent_internal_id, now_str)
                except Exception as e:
                    print(f"[ERROR] {fn.__name__} failed: {e}")

    except Exception as e:
        print(f"[ERROR] Fatal DB error processing agent_id={agent_id}: {e}")
        return False

    # Refresh the catalog snapshot so the agent appears in the UI immediately.
    try:
        from services.db.db_functions import refresh_curated_agent_360
        refresh_curated_agent_360(agent_internal_id, agent_id, tenant_id)
        print(f"[INFO] curated.agent_360 refreshed for agent_id={agent_id}")
    except Exception as e:
        print(f"[WARN] agent_360 refresh failed (agent will still appear at next scheduled refresh): {e}")

    print(f"[INFO] Upload processing done for agent_id={agent_id}. Risk assessment NOT triggered.")
    return True
