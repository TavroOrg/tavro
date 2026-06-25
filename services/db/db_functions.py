import json
import os
import uuid
from datetime import datetime
from pathlib import Path

import psycopg2
from psycopg2 import sql
from cvss import CVSS4
from utils.db import db_connection as _db_connection

CORE_SCHEMA             = os.getenv("CORE_DB_NAME",            "core")
RISK_MANAGEMENT_SCHEMA  = os.getenv("RISK_MANAGEMENT_DB_NAME", "risk_management")
CURATED_SCHEMA          = os.getenv("CURATED_DB_NAME",         "curated")

ALL_RISK_STATES    = ["Ready to take", "In progress", "Ready to finalize", "Completed", "Failed", "Cancelled"]
ACTIVE_RISK_STATES = ["Ready to take", "In progress", "Ready to finalize"]

# Ordered list of the 11 CVSS parameter column names (matches DB schema)
CVSS_PARAM_COLS = [
    "attack_vector_av",
    "attack_complexity_ac",
    "attack_requirements_at",
    "privileges_required_pr",
    "user_interaction_ui",
    "vulnerable_system_confidentiality_vc",
    "vulnerable_system_integrity_vi",
    "vulnerable_system_availability_va",
    "subsequent_system_confidentiality_sc",
    "subsequent_system_integrity_si",
    "subsequent_system_availability_sa",
]

SCENARIO_KEY_TO_DISPLAY = {
    "agentic_ai_tool_misuse":                           "Agentic AI Tool Misuse",
    "agent_access_control_violation":                   "Agent Access Control Violation",
    "agent_cascading_failures":                         "Agent Cascading Failures",
    "agent_orchestration_and_multi_agent_exploitation": "Agent Orchestration and Multi-Agent Exploitation",
    "agent_identity_impersonation":                     "Agent Identity Impersonation",
    "insecure_agent_critical_systems_interaction":      "Insecure Agent Critical Systems Interaction",
    "agent_memory_and_context_manipulation":            "Agent Memory and Context Manipulation",
    "agent_supply_chain_and_dependency_attacks":        "Agent Supply Chain and Dependency Attacks",
    "agent_untraceability":                             "Agent Untraceability",
    "agent_goal_and_instruction_manipulation":          "Agent Goal and Instruction Manipulation",
}




# ---------------------------------------------------------------------------
# SQL identifier helper
# ---------------------------------------------------------------------------

def _table(schema_name: str, table_name: str) -> sql.Composed:
    return sql.SQL("{}.{}").format(sql.Identifier(schema_name), sql.Identifier(table_name))


def _lock_agent_assessment(cursor, agent_internal_id: str, tenant_id: str = None) -> None:
    """Serialize risk-assessment creation/update for one logical tenant+agent."""
    lock_key = f"risk-assessment:{tenant_id or '__default__'}:{agent_internal_id}"
    cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock_key,))


# ---------------------------------------------------------------------------
# Pure-Python helpers  (no DB interaction)
# ---------------------------------------------------------------------------

def _normalize_tenant_id(value):
    """
    Normalise tenant_id so that whitespace-only / empty strings are treated
    as None rather than as meaningful identifiers.
    """
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return str(value).strip() or None


def _parse_aars_score(fmt_string) -> float:
    """
    Parse the formatted AARS factor string produced by aars_risk_evaluation,
    e.g. 'Full (1.0)' -> 1.0, 'Partial (0.5)' -> 0.5, 'None (0.0)' -> 0.0.
    Falls back to 0.0 on any parse error.
    """
    try:
        return float(fmt_string.split("(")[-1].rstrip(")").strip())
    except Exception:
        return 0.0


def _extract_aars_data(response_data: dict) -> dict:
    """
    Extract and parse all AARS factor scores and rationales from response_data.
    Returns a flat dict ready to be used as SQL parameters.
    """
    aars_factors    = response_data.get("aars_factors",    {})
    aars_rationales = response_data.get("aars_rationales", {})
    return {
        "aars_score":               float(response_data.get("aars_total_score", 0)),
        "autonomy_of_action":       _parse_aars_score(aars_factors.get("autonomy_of_action",       "None (0.0)")),
        "tool_use":                 _parse_aars_score(aars_factors.get("tool_use",                 "None (0.0)")),
        "memory_use":               _parse_aars_score(aars_factors.get("memory_use",               "None (0.0)")),
        "dynamic_identity":         _parse_aars_score(aars_factors.get("dynamic_identity",         "None (0.0)")),
        "multi_agent_interactions": _parse_aars_score(aars_factors.get("multi_agent_interactions", "None (0.0)")),
        "non_determinism":          _parse_aars_score(aars_factors.get("non_determinism",          "None (0.0)")),
        "self_modification":        _parse_aars_score(aars_factors.get("self_modification",        "None (0.0)")),
        "goal_driven_planning":     _parse_aars_score(aars_factors.get("goal_driven_planning",     "None (0.0)")),
        "contextual_awareness":     _parse_aars_score(aars_factors.get("contextual_awareness",     "None (0.0)")),
        "opacity_reflexivity":      _parse_aars_score(aars_factors.get("opacity_reflexivity",      "None (0.0)")),
        "r_autonomy":        aars_rationales.get("autonomy_of_action_rationale",       ""),
        "r_tool_use":        aars_rationales.get("dynamic_tool_use_rationale",         ""),
        "r_memory":          aars_rationales.get("memory_use_rationale",               ""),
        "r_identity":        aars_rationales.get("dynamic_identity_rationale",         ""),
        "r_multi_agent":     aars_rationales.get("multi_agent_interactions_rationale", ""),
        "r_non_determinism": aars_rationales.get("non_determinism_rationale",          ""),
        "r_self_mod":        aars_rationales.get("self_modification_rationale",        ""),
        "r_goal":            aars_rationales.get("goal_driven_planning_rationale",     ""),
        "r_context":         aars_rationales.get("contextual_awareness_rationale",     ""),
        "r_opacity":         aars_rationales.get("opacity_reflexivity_rationale",      ""),
    }


def _regulatory_risk_score(risk_classification: str) -> float:
    """Map EU AI Act risk classification → numeric score."""
    mapping = {
        "Prohibited": 10.0,
        "High Risk":   7.0,
    }
    return mapping.get(risk_classification, 1.0)


def _blended_risk_class(score: float) -> str:
    if score >= 7:
        return "High"
    elif score >= 3:
        return "Medium"
    return "Low"


def _aivss_class(score: float) -> str:
    """Same banding as blended_risk_class."""
    return _blended_risk_class(score)


# ---------------------------------------------------------------------------
# CVSS helpers
# ---------------------------------------------------------------------------

def generate_cvss_vector(
    attack_vector_av, attack_complexity_ac, attack_requirements_at,
    privileges_required_pr, user_interaction_ui,
    vulnerable_system_confidentiality_vc, vulnerable_system_integrity_vi,
    vulnerable_system_availability_va,
    subsequent_system_confidentiality_sc, subsequent_system_integrity_si,
    subsequent_system_availability_sa,
) -> str:
    """Build a CVSS 4.0 vector string from component values."""
    return (
        f"CVSS:4.0"
        f"/AV:{attack_vector_av}/AC:{attack_complexity_ac}/AT:{attack_requirements_at}"
        f"/PR:{privileges_required_pr}/UI:{user_interaction_ui}"
        f"/VC:{vulnerable_system_confidentiality_vc}/VI:{vulnerable_system_integrity_vi}"
        f"/VA:{vulnerable_system_availability_va}"
        f"/SC:{subsequent_system_confidentiality_sc}"
        f"/SI:{subsequent_system_integrity_si}/SA:{subsequent_system_availability_sa}"
    )


def calculate_cvss_score(cvss_vector: str) -> float:
    """Return the CVSS 4.0 base score for the given vector string."""
    c = CVSS4(cvss_vector)
    return c.base_score


# ---------------------------------------------------------------------------
# Internal insert helper  (risk_management.agent_risk_assessment)
# ---------------------------------------------------------------------------

def _execute_insert(
    cursor,
    assessment_id:  str,
    created_ts:     datetime,
    updated_ts:     datetime,
    type_of_risk:   str,
    response_data:  dict,
    aars:           dict,        # output of _extract_aars_data()
    tenant_id:      str = None,
    company_id:     str = None,
) -> None:
    """
    Fire a new-record INSERT into risk_management.agent_risk_assessment.
    All values are passed as psycopg2 parameters – no string interpolation.
    """
    article_5  = json.dumps(response_data["article_5"])
    article_6  = json.dumps(response_data["article_6"])
    agent_name = response_data["agent_name"]

    insert_query = sql.SQL(
        """
        INSERT INTO {risk_table} (
            assessment_id,
            agent_internal_id,
            agent_id,
            tenant_id,
            company_id,
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
            aars_score,
            autonomy_of_action,               autonomy_of_action_rationale,
            dynamic_tool_use,                 dynamic_tool_use_rationale,
            memory_use,                       memory_use_rationale,
            dynamic_identity,                 dynamic_identity_rationale,
            multi_agent_interactions,         multi_agent_interactions_rationale,
            non_determinism,                  non_determinism_rationale,
            self_modification,                self_modification_rationale,
            goal_driven_planning,             goal_driven_planning_rationale,
            contextual_awareness,             contextual_awareness_rationale,
            opacity_reflexivity,              opacity_reflexivity_rationale,
            created_ts,
            created_by,
            updated_ts,
            updated_by,
            assessor,
            state
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s
        )
        """
    ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))

    cursor.execute(
        insert_query,
        (
            assessment_id,
            response_data["agent_internal_id"],
            response_data["agent_id"],
            tenant_id,
            company_id,
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
            # AARS scores + rationales (10 pairs + total)
            aars["aars_score"],
            aars["autonomy_of_action"],       aars["r_autonomy"],
            aars["tool_use"],                 aars["r_tool_use"],
            aars["memory_use"],               aars["r_memory"],
            aars["dynamic_identity"],         aars["r_identity"],
            aars["multi_agent_interactions"], aars["r_multi_agent"],
            aars["non_determinism"],          aars["r_non_determinism"],
            aars["self_modification"],        aars["r_self_mod"],
            aars["goal_driven_planning"],     aars["r_goal"],
            aars["contextual_awareness"],     aars["r_context"],
            aars["opacity_reflexivity"],      aars["r_opacity"],
            # Audit fields
            created_ts,
            "Admin",
            updated_ts,
            "Admin",
            "Admin",
            "Ready to take",
        ),
    )
    print(cursor.mogrify(insert_query, (
        assessment_id,
        response_data["agent_internal_id"],
        response_data["agent_id"],
        tenant_id,
        company_id,
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
        # AARS scores + rationales (10 pairs + total)
        aars["aars_score"],
        aars["autonomy_of_action"],       aars["r_autonomy"],
        aars["tool_use"],                 aars["r_tool_use"],
        aars["memory_use"],               aars["r_memory"],
        aars["dynamic_identity"],         aars["r_identity"],
        aars["multi_agent_interactions"], aars["r_multi_agent"],
        aars["non_determinism"],          aars["r_non_determinism"],
        aars["self_modification"],        aars["r_self_mod"],
        aars["goal_driven_planning"],     aars["r_goal"],
        aars["contextual_awareness"],     aars["r_context"],
        aars["opacity_reflexivity"],      aars["r_opacity"],
        # Audit fields
        created_ts,
        "Admin",
        updated_ts,
        "Admin",
        "Admin",
        "Ready to take",
    )).decode())
    if cursor.rowcount != 1:
        raise RuntimeError(
            f"Failed to insert new assessment row for assessment_id={assessment_id} "
            f"rowcount={cursor.rowcount}"
        )
    print(
        f"[{RISK_MANAGEMENT_SCHEMA}] Inserted assessment_id={assessment_id} "
        f"agent_internal_id={response_data['agent_internal_id']} "
        f"aars_score={aars['aars_score']}"
    )


# ---------------------------------------------------------------------------
# Main upsert  (risk_management.agent_risk_assessment + agent_risk_scenarios)
# ---------------------------------------------------------------------------

def insert_or_update_into_postgres(response_data: dict, tenant_id: str = None) -> str:
    """
    Upsert agent risk assessment data into:
      - risk_management.agent_risk_assessment
      - risk_management.agent_risk_scenarios  (10 standard scenarios)

    response_data must contain the flat keys produced by the calling workflow,
    including 'aars_factors', 'aars_rationales', and 'aars_total_score'.

    Returns the assessment_id (new or existing) that was written to.
    """
    tenant_id         = _normalize_tenant_id(tenant_id)
    if tenant_id is None and isinstance(response_data, dict):
        tenant_id     = _normalize_tenant_id(response_data.get("tenant_id"))

    now_ts            = datetime.now()
    assessment_id     = str(uuid.uuid4())
    agent_internal_id = response_data["agent_internal_id"]
    agent_id          = response_data["agent_id"]

    aars = _extract_aars_data(response_data)

    # Look up company_id from core.agents for this agent
    company_id = None
    try:
        with _db_connection() as _conn:
            with _conn.cursor() as _cur:
                _cur.execute(
                    sql.SQL("SELECT company_id FROM {agents} WHERE agent_internal_id = %s AND is_current = TRUE LIMIT 1").format(
                        agents=_table(CORE_SCHEMA, "agents")
                    ),
                    (agent_internal_id,),
                )
                _row = _cur.fetchone()
                if _row:
                    company_id = _row[0] or None
    except Exception:
        pass

    # CVSS params forwarded to scenario rows
    cvss_params = {col: response_data[col] for col in CVSS_PARAM_COLS}

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            _lock_agent_assessment(cursor, agent_internal_id, tenant_id)

            # ---- Check for existing records ---------------------------------
            check_query = sql.SQL(
                """
                SELECT assessment_id, state
                FROM {risk_table}
                WHERE agent_internal_id = %s
                  AND state = ANY(%s)
                  AND (%s IS NULL OR tenant_id = %s)
                ORDER BY
                    CASE WHEN state = ANY(%s) THEN 0 ELSE 1 END,
                    updated_ts DESC NULLS LAST,
                    created_ts DESC NULLS LAST
                FOR UPDATE
                """
            ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))
            print(cursor.mogrify(check_query, (agent_internal_id, ALL_RISK_STATES, tenant_id, tenant_id, ACTIVE_RISK_STATES)).decode())
            cursor.execute(check_query, (agent_internal_id, ALL_RISK_STATES, tenant_id, tenant_id, ACTIVE_RISK_STATES))
            rows = cursor.fetchall()
            print(f"Existing records found: {rows}")

            type_of_risk = "Residual Risk" if rows else "Inherent Risk"
            active_row   = next((row for row in rows if row[1] in ACTIVE_RISK_STATES), None)

            if active_row:
                # ---- UPDATE existing active record --------------------------
                existing_assessment_id = active_row[0]

                update_query = sql.SQL(
                    """
                    UPDATE {risk_table}
                    SET
                        risk_classification                                    = %s,
                        personally_identifiable_information                    = %s,
                        protected_health_information                           = %s,
                        payment_card_industry                                  = %s,
                        eu_ai_act_article_5_prohibited_ai_practices_evaluation = %s,
                        eu_ai_act_article_6_high_risk_ai_systems_evaluation    = %s,
                        risk_classification_rationale                          = %s,
                        type_of_risk                                           = %s,
                        aars_score                                             = %s,
                        autonomy_of_action                                     = %s,
                        autonomy_of_action_rationale                           = %s,
                        dynamic_tool_use                                       = %s,
                        dynamic_tool_use_rationale                             = %s,
                        memory_use                                             = %s,
                        memory_use_rationale                                   = %s,
                        dynamic_identity                                       = %s,
                        dynamic_identity_rationale                             = %s,
                        multi_agent_interactions                               = %s,
                        multi_agent_interactions_rationale                     = %s,
                        non_determinism                                        = %s,
                        non_determinism_rationale                              = %s,
                        self_modification                                      = %s,
                        self_modification_rationale                            = %s,
                        goal_driven_planning                                   = %s,
                        goal_driven_planning_rationale                         = %s,
                        contextual_awareness                                   = %s,
                        contextual_awareness_rationale                         = %s,
                        opacity_reflexivity                                    = %s,
                        opacity_reflexivity_rationale                          = %s,
                        updated_ts                                             = %s,
                        updated_by                                             = %s
                    WHERE assessment_id = %s
                      AND state = ANY(%s)
                      AND (%s IS NULL OR tenant_id = %s)
                    """
                ).format(risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment"))

                print(cursor.mogrify(update_query, (
                    response_data["risk_classification"],
                    response_data["personally_identifiable_information"],
                    response_data["protected_health_information"],
                    response_data["payment_card_industry"],
                    json.dumps(response_data["article_5"]),
                    json.dumps(response_data["article_6"]),
                    response_data["risk_rating_rationale"],
                    type_of_risk,
                    aars["aars_score"],
                    aars["autonomy_of_action"],       aars["r_autonomy"],
                    aars["tool_use"],                 aars["r_tool_use"],
                    aars["memory_use"],               aars["r_memory"],
                    aars["dynamic_identity"],         aars["r_identity"],
                    aars["multi_agent_interactions"], aars["r_multi_agent"],
                    aars["non_determinism"],          aars["r_non_determinism"],
                    aars["self_modification"],        aars["r_self_mod"],
                    aars["goal_driven_planning"],     aars["r_goal"],
                    aars["contextual_awareness"],     aars["r_context"],
                    aars["opacity_reflexivity"],      aars["r_opacity"],
                    now_ts,
                    "Admin",
                    existing_assessment_id,
                    ACTIVE_RISK_STATES,
                    tenant_id,
                    tenant_id,
                )).decode())
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
                        aars["aars_score"],
                        aars["autonomy_of_action"],       aars["r_autonomy"],
                        aars["tool_use"],                 aars["r_tool_use"],
                        aars["memory_use"],               aars["r_memory"],
                        aars["dynamic_identity"],         aars["r_identity"],
                        aars["multi_agent_interactions"], aars["r_multi_agent"],
                        aars["non_determinism"],          aars["r_non_determinism"],
                        aars["self_modification"],        aars["r_self_mod"],
                        aars["goal_driven_planning"],     aars["r_goal"],
                        aars["contextual_awareness"],     aars["r_context"],
                        aars["opacity_reflexivity"],      aars["r_opacity"],
                        now_ts,
                        "Admin",
                        existing_assessment_id,
                        ACTIVE_RISK_STATES,
                        tenant_id,
                        tenant_id,
                    ),
                )
                if cursor.rowcount == 0:
                    raise RuntimeError(
                        f"Expected to update an existing active assessment for "
                        f"agent_internal_id={agent_internal_id}, but no rows were updated."
                    )
                print(f"Updated existing record assessment_id={existing_assessment_id}")

                # Recompute scenario CVSS/aivss scores in-transaction
                _update_risk_scenarios_cursor(
                    cursor,
                    existing_assessment_id,
                    aars["aars_score"],
                    now_ts,
                    tenant_id=tenant_id,
                    **cvss_params,
                )
                return existing_assessment_id

            else:
                # ---- INSERT new record (terminal or no prior records) -------
                _execute_insert(
                    cursor,
                    assessment_id,
                    now_ts,
                    now_ts,
                    type_of_risk,
                    response_data,
                    aars,
                    tenant_id=tenant_id,
                    company_id=company_id,
                )

                _insert_risk_scenarios_cursor(
                    cursor,
                    assessment_id,
                    aars["aars_score"],
                    now_ts,
                    now_ts,
                    tenant_id=tenant_id,
                    company_id=company_id,
                    **cvss_params,
                )
                return assessment_id


# ---------------------------------------------------------------------------
# Risk scenarios  (internal cursor-level helpers + public wrappers)
# ---------------------------------------------------------------------------

def _insert_risk_scenarios_cursor(
    cursor,
    assessment_id: str,
    aars_score:    float,
    created_ts:    datetime,
    updated_ts:    datetime,
    attack_vector_av:                     str,
    attack_complexity_ac:                 str,
    attack_requirements_at:               str,
    privileges_required_pr:               str,
    user_interaction_ui:                  str,
    vulnerable_system_confidentiality_vc: str,
    vulnerable_system_integrity_vi:       str,
    vulnerable_system_availability_va:    str,
    subsequent_system_confidentiality_sc: str,
    subsequent_system_integrity_si:       str,
    subsequent_system_availability_sa:    str,
    tenant_id:  str = None,
    company_id: str = None,
) -> None:
    """
    Bulk-insert 10 standard risk scenarios into agent_risk_scenarios.
    Executed within an already-open cursor/transaction.
    """
    risk_scenario_names = list(SCENARIO_KEY_TO_DISPLAY.values())

    vector = generate_cvss_vector(
        attack_vector_av=attack_vector_av,
        attack_complexity_ac=attack_complexity_ac,
        attack_requirements_at=attack_requirements_at,
        privileges_required_pr=privileges_required_pr,
        user_interaction_ui=user_interaction_ui,
        vulnerable_system_confidentiality_vc=vulnerable_system_confidentiality_vc,
        vulnerable_system_integrity_vi=vulnerable_system_integrity_vi,
        vulnerable_system_availability_va=vulnerable_system_availability_va,
        subsequent_system_confidentiality_sc=subsequent_system_confidentiality_sc,
        subsequent_system_integrity_si=subsequent_system_integrity_si,
        subsequent_system_availability_sa=subsequent_system_availability_sa,
    )
    cvss_score  = calculate_cvss_score(vector)
    aivss_score = round(((cvss_score + aars_score) / 2) * 1.0, 4)

    insert_query = sql.SQL(
        """
        INSERT INTO {scenarios_table} (
            risk_scenario_id,
            assessment_id,
            tenant_id,
            company_id,
            agentic_ai_core_security_risks,
            attack_vector_av,
            attack_complexity_ac,
            attack_requirements_at,
            privileges_required_pr,
            user_interaction_ui,
            vulnerable_system_confidentiality_vc,
            vulnerable_system_integrity_vi,
            vulnerable_system_availability_va,
            subsequent_system_confidentiality_sc,
            subsequent_system_integrity_si,
            subsequent_system_availability_sa,
            cvss_4_0_vector,
            cvss_score,
            threat_multiplier,
            aivss_score,
            created_ts,
            created_by,
            updated_ts,
            updated_by
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s
        )
        """
    ).format(scenarios_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_scenarios"))

    rows = [
        (
            str(uuid.uuid4()),
            assessment_id,
            tenant_id,
            company_id,
            risk_name,
            attack_vector_av,
            attack_complexity_ac,
            attack_requirements_at,
            privileges_required_pr,
            user_interaction_ui,
            vulnerable_system_confidentiality_vc,
            vulnerable_system_integrity_vi,
            vulnerable_system_availability_va,
            subsequent_system_confidentiality_sc,
            subsequent_system_integrity_si,
            subsequent_system_availability_sa,
            vector,
            cvss_score,
            1.0,
            aivss_score,
            created_ts,
            "Admin",
            updated_ts,
            "Admin",
        )
        for risk_name in risk_scenario_names
    ]

    cursor.executemany(insert_query, rows)
    if rows:
        print(cursor.mogrify(insert_query, rows[0]).decode())
    print(f"Bulk-inserted {len(rows)} risk scenarios for assessment_id={assessment_id}")


def insert_risk_scenarios(
    assessment_id: str,
    aars_score:    float,
    created_ts:    datetime,
    updated_ts:    datetime,
    attack_vector_av:                     str,
    attack_complexity_ac:                 str,
    attack_requirements_at:               str,
    privileges_required_pr:               str,
    user_interaction_ui:                  str,
    vulnerable_system_confidentiality_vc: str,
    vulnerable_system_integrity_vi:       str,
    vulnerable_system_availability_va:    str,
    subsequent_system_confidentiality_sc: str,
    subsequent_system_integrity_si:       str,
    subsequent_system_availability_sa:    str,
    tenant_id:  str = None,
    company_id: str = None,
) -> None:
    """Public wrapper: bulk-insert 10 standard risk scenarios (opens its own connection)."""
    with _db_connection() as connection:
        with connection.cursor() as cursor:
            _insert_risk_scenarios_cursor(
                cursor,
                assessment_id,
                aars_score,
                created_ts,
                updated_ts,
                attack_vector_av=attack_vector_av,
                attack_complexity_ac=attack_complexity_ac,
                attack_requirements_at=attack_requirements_at,
                privileges_required_pr=privileges_required_pr,
                user_interaction_ui=user_interaction_ui,
                vulnerable_system_confidentiality_vc=vulnerable_system_confidentiality_vc,
                vulnerable_system_integrity_vi=vulnerable_system_integrity_vi,
                vulnerable_system_availability_va=vulnerable_system_availability_va,
                subsequent_system_confidentiality_sc=subsequent_system_confidentiality_sc,
                subsequent_system_integrity_si=subsequent_system_integrity_si,
                subsequent_system_availability_sa=subsequent_system_availability_sa,
                tenant_id=tenant_id,
                company_id=company_id,
            )


def _update_risk_scenarios_cursor(
    cursor,
    assessment_id: str,
    aars_score:    float,
    updated_ts:    datetime,
    attack_vector_av:                     str,
    attack_complexity_ac:                 str,
    attack_requirements_at:               str,
    privileges_required_pr:               str,
    user_interaction_ui:                  str,
    vulnerable_system_confidentiality_vc: str,
    vulnerable_system_integrity_vi:       str,
    vulnerable_system_availability_va:    str,
    subsequent_system_confidentiality_sc: str,
    subsequent_system_integrity_si:       str,
    subsequent_system_availability_sa:    str,
    tenant_id: str = None,
) -> None:
    """
    Recompute cvss_score and aivss_score for every scenario tied to this
    assessment and persist the updated values. Runs inside an existing transaction.
    """
    vector = generate_cvss_vector(
        attack_vector_av=attack_vector_av,
        attack_complexity_ac=attack_complexity_ac,
        attack_requirements_at=attack_requirements_at,
        privileges_required_pr=privileges_required_pr,
        user_interaction_ui=user_interaction_ui,
        vulnerable_system_confidentiality_vc=vulnerable_system_confidentiality_vc,
        vulnerable_system_integrity_vi=vulnerable_system_integrity_vi,
        vulnerable_system_availability_va=vulnerable_system_availability_va,
        subsequent_system_confidentiality_sc=subsequent_system_confidentiality_sc,
        subsequent_system_integrity_si=subsequent_system_integrity_si,
        subsequent_system_availability_sa=subsequent_system_availability_sa,
    )
    cvss_score  = calculate_cvss_score(vector)
    aivss_score = round(((cvss_score + aars_score) / 2) * 1.0, 4)

    update_query = sql.SQL(
        """
        UPDATE {scenarios_table}
        SET
            cvss_4_0_vector                      = %s,
            cvss_score                           = %s,
            aivss_score                          = %s,
            attack_vector_av                     = %s,
            attack_complexity_ac                 = %s,
            attack_requirements_at               = %s,
            privileges_required_pr               = %s,
            user_interaction_ui                  = %s,
            vulnerable_system_confidentiality_vc = %s,
            vulnerable_system_integrity_vi       = %s,
            vulnerable_system_availability_va    = %s,
            subsequent_system_confidentiality_sc = %s,
            subsequent_system_integrity_si       = %s,
            subsequent_system_availability_sa    = %s,
            updated_ts                           = %s,
            updated_by                           = %s
        WHERE assessment_id = %s
          AND (%s IS NULL OR tenant_id = %s)
        """
    ).format(scenarios_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_scenarios"))

    print(cursor.mogrify(update_query, (
        vector, cvss_score, aivss_score,
        attack_vector_av, attack_complexity_ac, attack_requirements_at,
        privileges_required_pr, user_interaction_ui,
        vulnerable_system_confidentiality_vc, vulnerable_system_integrity_vi,
        vulnerable_system_availability_va,
        subsequent_system_confidentiality_sc, subsequent_system_integrity_si,
        subsequent_system_availability_sa,
        updated_ts,
        "Admin",
        assessment_id,
        tenant_id, tenant_id,
    )).decode())
    cursor.execute(
        update_query,
        (
            vector, cvss_score, aivss_score,
            attack_vector_av, attack_complexity_ac, attack_requirements_at,
            privileges_required_pr, user_interaction_ui,
            vulnerable_system_confidentiality_vc, vulnerable_system_integrity_vi,
            vulnerable_system_availability_va,
            subsequent_system_confidentiality_sc, subsequent_system_integrity_si,
            subsequent_system_availability_sa,
            updated_ts,
            "Admin",
            assessment_id,
            tenant_id, tenant_id,
        ),
    )
    print(f"Updated risk scenarios for assessment_id={assessment_id} cvss_score={cvss_score}")


def update_risk_scenarios(
    assessment_id: str,
    aars_score:    float,
    updated_ts:    datetime,
    attack_vector_av:                     str,
    attack_complexity_ac:                 str,
    attack_requirements_at:               str,
    privileges_required_pr:               str,
    user_interaction_ui:                  str,
    vulnerable_system_confidentiality_vc: str,
    vulnerable_system_integrity_vi:       str,
    vulnerable_system_availability_va:    str,
    subsequent_system_confidentiality_sc: str,
    subsequent_system_integrity_si:       str,
    subsequent_system_availability_sa:    str,
    tenant_id: str = None,
) -> None:
    """Public wrapper: recompute & update scenario CVSS/aivss scores (opens its own connection)."""
    with _db_connection() as connection:
        with connection.cursor() as cursor:
            _update_risk_scenarios_cursor(
                cursor,
                assessment_id,
                aars_score,
                updated_ts,
                attack_vector_av=attack_vector_av,
                attack_complexity_ac=attack_complexity_ac,
                attack_requirements_at=attack_requirements_at,
                privileges_required_pr=privileges_required_pr,
                user_interaction_ui=user_interaction_ui,
                vulnerable_system_confidentiality_vc=vulnerable_system_confidentiality_vc,
                vulnerable_system_integrity_vi=vulnerable_system_integrity_vi,
                vulnerable_system_availability_va=vulnerable_system_availability_va,
                subsequent_system_confidentiality_sc=subsequent_system_confidentiality_sc,
                subsequent_system_integrity_si=subsequent_system_integrity_si,
                subsequent_system_availability_sa=subsequent_system_availability_sa,
                tenant_id=tenant_id,
            )


# ---------------------------------------------------------------------------
# CVSS & AIVSS update for assessment (per-scenario + overall summary)
# ---------------------------------------------------------------------------

def update_cvss_for_assessment(
    agent_internal_id: str,
    assessment_id:     str,
    aars_score:        float,
    cvss_result:       dict,
    updated_ts:        str,
    risk_classification: str = None,
    tenant_id:         str = None,
) -> None:
    print("update_cvss_for_assessment CALLED")

    tenant_id = _normalize_tenant_id(tenant_id)

    SCENARIO_KEY_TO_DISPLAY = {
        "agentic_ai_tool_misuse": "Agentic AI Tool Misuse",
        "agent_access_control_violation": "Agent Access Control Violation",
        "agent_cascading_failures": "Agent Cascading Failures",
        "agent_orchestration_and_multi_agent_exploitation": "Agent Orchestration and Multi-Agent Exploitation",
        "agent_identity_impersonation": "Agent Identity Impersonation",
        "agent_memory_and_context_manipulation": "Agent Memory and Context Manipulation",
        "insecure_agent_critical_systems_interaction": "Insecure Agent Critical Systems Interaction",
        "agent_supply_chain_and_dependency_attacks": "Agent Supply Chain and Dependency Attacks",
        "agent_untraceability": "Agent Untraceability",
        "agent_goal_and_instruction_manipulation": "Agent Goal and Instruction Manipulation",
    }

    CVSS_PARAM_COLS = [
        "attack_vector_av",
        "attack_complexity_ac",
        "attack_requirements_at",
        "privileges_required_pr",
        "user_interaction_ui",
        "vulnerable_system_confidentiality_vc",
        "vulnerable_system_integrity_vi",
        "vulnerable_system_availability_va",
        "subsequent_system_confidentiality_sc",
        "subsequent_system_integrity_si",
        "subsequent_system_availability_sa",
    ]

    overall_data = cvss_result.get("Overall Data", {})
    cvss_numeric = cvss_result.get("CVSS Numeric", {})
    cvss_vectors = cvss_result.get("CVSS Scores", {})

    scenario_rows = []

    for scenario_key, params in overall_data.items():
        if scenario_key == "overall_risk_summary":
            continue

        display_name = SCENARIO_KEY_TO_DISPLAY.get(scenario_key)
        if not display_name:
            raise RuntimeError(f"Unknown scenario key: {scenario_key}")

        cvss_score = float(cvss_numeric.get(display_name, 0.0))
        vector = cvss_vectors.get(display_name, "")
        aivss_score = round((cvss_score + aars_score) / 2, 4)

        cvss_params = {col: params.get(col, "") for col in CVSS_PARAM_COLS}

        scenario_rows.append((display_name, vector, cvss_score, aivss_score, cvss_params))

    if not scenario_rows:
        raise RuntimeError(f"No scenario rows generated for assessment_id={assessment_id}")

    max_cvss_score = max(r[2] for r in scenario_rows)
    final_aivss_score = round((max_cvss_score + aars_score) / 2, 4)

    updated_dt = (
        datetime.strptime(updated_ts, "%Y-%m-%d %H:%M:%S")
        if isinstance(updated_ts, str)
        else updated_ts
    )

    with _db_connection() as connection:
        with connection.cursor() as cursor:

            # ─────────────────────────────────────────────
            # SCENARIO UPDATE
            # ─────────────────────────────────────────────
            scenario_update_query = sql.SQL("""
                UPDATE {scenarios_table}
                SET
                    cvss_4_0_vector = %s,
                    cvss_score = %s,
                    aivss_score = %s,
                    attack_vector_av = %s,
                    attack_complexity_ac = %s,
                    attack_requirements_at = %s,
                    privileges_required_pr = %s,
                    user_interaction_ui = %s,
                    vulnerable_system_confidentiality_vc = %s,
                    vulnerable_system_integrity_vi = %s,
                    vulnerable_system_availability_va = %s,
                    subsequent_system_confidentiality_sc = %s,
                    subsequent_system_integrity_si = %s,
                    subsequent_system_availability_sa = %s,
                    updated_ts = %s,
                    updated_by = 'Admin'
                WHERE assessment_id = %s
                  AND agentic_ai_core_security_risks = %s
                  AND (%s IS NULL OR tenant_id = %s)
            """).format(
                scenarios_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_scenarios")
            )

            scenario_updates = 0

            for display_name, vector, cvss_score, aivss_score, params in scenario_rows:
                values = (
                    vector,
                    cvss_score,
                    aivss_score,
                    params["attack_vector_av"],
                    params["attack_complexity_ac"],
                    params["attack_requirements_at"],
                    params["privileges_required_pr"],
                    params["user_interaction_ui"],
                    params["vulnerable_system_confidentiality_vc"],
                    params["vulnerable_system_integrity_vi"],
                    params["vulnerable_system_availability_va"],
                    params["subsequent_system_confidentiality_sc"],
                    params["subsequent_system_integrity_si"],
                    params["subsequent_system_availability_sa"],
                    updated_dt,
                    assessment_id,
                    display_name,
                    tenant_id,
                    tenant_id,
                )

                # 🔍 PRINT FULL QUERY
                print(cursor.mogrify(scenario_update_query, values).decode())

                try:
                    cursor.execute(scenario_update_query, values)
                    if cursor.rowcount != 1:
                        raise RuntimeError(
                            f"Expected exactly one scenario row for assessment_id={assessment_id}, "
                            f"scenario={display_name}; rowcount={cursor.rowcount}"
                        )
                    scenario_updates += cursor.rowcount
                except Exception as e:
                    raise RuntimeError(f"Scenario update failed for {display_name}") from e

            if scenario_updates != len(scenario_rows):
                raise RuntimeError(
                    f"Updated {scenario_updates}/{len(scenario_rows)} scenario rows "
                    f"for assessment_id={assessment_id}"
                )

            # ─────────────────────────────────────────────
            # RISK TYPE
            # ─────────────────────────────────────────────
            risk_type_query = sql.SQL("""
                SELECT COUNT(*)
                FROM {risk_table}
                WHERE agent_internal_id = %s
                  AND assessment_id != %s
                  AND (%s IS NULL OR tenant_id = %s)
            """).format(
                risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")
            )

            risk_values = (agent_internal_id, assessment_id, tenant_id, tenant_id)

            # 🔍 PRINT FULL QUERY
            print(cursor.mogrify(risk_type_query, risk_values).decode())

            cursor.execute(risk_type_query, risk_values)

            other_count = cursor.fetchone()[0]
            type_of_risk = "Residual Risk" if other_count > 0 else "Inherent Risk"

            # ─────────────────────────────────────────────
            # FINAL UPDATE
            # ─────────────────────────────────────────────
            reg_risk_score = _regulatory_risk_score(risk_classification) if risk_classification else 0.0
            blended_risk_score = round((0.8 * final_aivss_score) + (reg_risk_score * 0.2), 2)

            assessment_update_query = sql.SQL("""
                UPDATE {risk_table}
                SET
                    state = 'Completed',
                    cvss_score = %s,
                    aivss_score = %s,
                    risk_classification_score = %s,
                    blended_risk_score = %s,    
                    type_of_risk = %s,
                    updated_ts = %s,                          
                    updated_by = 'Admin'
                WHERE assessment_id = %s
                  AND (%s IS NULL OR tenant_id = %s)
            """).format(
                risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")
            )

            assessment_values = (
                max_cvss_score,
                final_aivss_score,
                reg_risk_score,
                blended_risk_score,
                type_of_risk,
                updated_dt,
                assessment_id,
                tenant_id,
                tenant_id,
            )

            # 🔍 PRINT FULL QUERY
            print(cursor.mogrify(assessment_update_query, assessment_values).decode())

            try:
                cursor.execute(assessment_update_query, assessment_values)

                if cursor.rowcount == 0:
                    raise RuntimeError(
                        f"Failed to update assessment row (no matching record): {assessment_id}"
                    )

            except Exception as e:
                raise RuntimeError(
                    f"Assessment update failed for {assessment_id}"
                ) from e


# ---------------------------------------------------------------------------
# Assessment name lookup
# ---------------------------------------------------------------------------

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
            print(cursor.mogrify(query, (risk_assessment_id,)).decode())
            cursor.execute(query, (risk_assessment_id,))
            row = cursor.fetchone()

    if not row:
        raise Exception(f"No assessment found for ID: {risk_assessment_id}")
    return row[0]


# ---------------------------------------------------------------------------
# Core risk assessment  (core.agent_risk_assessments  – SCD-2 table)
# ---------------------------------------------------------------------------

def _refresh_are_for_agent(cursor, agent_id: str, agent_internal_id: str, tenant_id: str) -> None:
    """Recalculate ARE/ART/blended_risk_score for every linked application, process, and AI use case."""

    def _art_from_are(are: float) -> str:
        if are >= 9.0:
            return "Critical"
        if are >= 7.0:
            return "High"
        if are >= 3.0:
            return "Medium"
        return "Low"

    # ── Applications ──────────────────────────────────────────────────────────
    cursor.execute(
        sql.SQL("""
            SELECT DISTINCT ba.business_application_id,
                   ba.business_criticality,
                   ba.emergency_tier
            FROM {link} lnk
            JOIN {ba} ba USING (business_application_id)
            WHERE lnk.agent_id = %s OR lnk.agent_internal_id = %s
        """).format(
            link=sql.Identifier(CORE_SCHEMA, "agent_business_applications"),
            ba=sql.Identifier(CORE_SCHEMA, "business_applications"),
        ),
        (agent_id, agent_internal_id),
    )
    for row in cursor.fetchall():
        app_id, bc_raw, et_raw = row

        bc = (bc_raw or "").strip().lower()
        bc_score = {"high": 1.0, "medium": 0.4, "low": 0.1}.get(bc, 0.0)

        et = (et_raw or "").strip().lower()
        et_score = {"mission critical": 1.0, "business critical": 0.4,
                    "non-critical": 0.1, "non critical": 0.1}.get(et, 0.0)

        cursor.execute(
            sql.SQL("""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {link} lnk
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {ara} ara
                    WHERE ara.agent_id = lnk.agent_id
                      AND ara.blended_risk_score IS NOT NULL
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE lnk.business_application_id = %s
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
            """).format(
                link=sql.Identifier(CORE_SCHEMA, "agent_business_applications"),
                ara=sql.Identifier(CORE_SCHEMA, "agent_risk_assessments"),
            ),
            (app_id,),
        )
        worst_app_row = cursor.fetchone()
        max_brs = float((worst_app_row[1] if worst_app_row else None) or 0.0)
        worst_app_internal_id = worst_app_row[0] if worst_app_row else None
        are = round(max_brs * (bc_score + et_score) / 2.0, 2)
        art = _art_from_are(are)

        inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
        if worst_app_internal_id:
            cursor.execute(
                sql.SQL("""
                    SELECT type_of_risk, risk_classification, risk_classification_score
                    FROM {risk_table}
                    WHERE agent_internal_id = %s
                      AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ORDER BY created_ts DESC
                """).format(risk_table=sql.Identifier(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")),
                (worst_app_internal_id,),
            )
            for tor, rc, rcs in cursor.fetchall():
                if tor == "Inherent Risk" and not inherent_class:
                    inherent_class = rc or ""
                    inherent_score = float(rcs or 0.0)
                elif tor == "Residual Risk" and not residual_class:
                    residual_class = rc or ""
                    residual_score = float(rcs or 0.0)

        cursor.execute(
            sql.SQL("""
                UPDATE {ba}
                SET blended_risk_score = %s,
                    agent_risk_exposure = %s,
                    agent_risk_tier     = %s,
                    inherent_risk_classification = %s,
                    inherent_risk_classification_score = %s,
                    residual_risk_classification = %s,
                    residual_risk_classification_score = %s,
                    updated_ts          = NOW()
                WHERE business_application_id = %s
            """).format(ba=sql.Identifier(CORE_SCHEMA, "business_applications")),
            (max_brs, are, art, inherent_class, inherent_score, residual_class, residual_score, app_id),
        )

    # ── Processes ─────────────────────────────────────────────────────────────
    cursor.execute(
        sql.SQL("""
            SELECT DISTINCT bp.business_process_id,
                   bp.business_criticality,
                   bp.financial_impact,
                   bp.reputational_impact,
                   bp.regulatory_impact
            FROM {link} lnk
            JOIN {bp} bp USING (business_process_id)
            WHERE lnk.agent_id = %s OR lnk.agent_internal_id = %s
        """).format(
            link=sql.Identifier(CORE_SCHEMA, "agent_business_processes"),
            bp=sql.Identifier(CORE_SCHEMA, "business_processes"),
        ),
        (agent_id, agent_internal_id),
    )
    for row in cursor.fetchall():
        proc_id, bc_raw, fi_raw, ri_raw, rgi_raw = row

        bc = (bc_raw or "").strip().lower()
        bc_score = {
            "tier 1 (systemic)": 1.0, "tier 2 (core)": 0.7,
            "tier 3 (operational)": 0.4, "tier 4 (experimental)": 0.1,
            "1.0": 1.0, "0.7": 0.7, "0.4": 0.4, "0.1": 0.1,
        }.get(bc, 0.0)

        fi = (fi_raw or "").strip().lower()
        fi_score = {
            "systemic": 1.0, "1": 1.0,
            "material": 0.7, "0.7": 0.7,
            "absorbable": 0.4, "0.4": 0.4,
            "immaterial": 0.1, "0.1": 0.1,
        }.get(fi, 0.0)

        ri = (ri_raw or "").strip().lower()
        ri_score = {
            "toxic": 1.0, "1": 1.0,
            "adverse": 0.7, "0.7": 0.7,
            "private": 0.4, "0.4": 0.4,
            "contained": 0.1, "0.1": 0.1,
        }.get(ri, 0.0)

        rgi = (rgi_raw or "").strip().lower()
        rgi_score = {
            "restricted": 1.0, "1": 1.0,
            "statutory": 0.7, "0.7": 0.7,
            "governed": 0.4, "0.4": 0.4,
            "unregulated": 0.1, "0.1": 0.1,
        }.get(rgi, 0.0)

        cursor.execute(
            sql.SQL("""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {link} lnk
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {ara} ara
                    WHERE ara.agent_id = lnk.agent_id
                      AND ara.blended_risk_score IS NOT NULL
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE lnk.business_process_id = %s
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
            """).format(
                link=sql.Identifier(CORE_SCHEMA, "agent_business_processes"),
                ara=sql.Identifier(CORE_SCHEMA, "agent_risk_assessments"),
            ),
            (proc_id,),
        )
        worst_proc_row = cursor.fetchone()
        max_brs = float((worst_proc_row[1] if worst_proc_row else None) or 0.0)
        worst_proc_internal_id = worst_proc_row[0] if worst_proc_row else None
        are = round(max_brs * (bc_score + fi_score + ri_score + rgi_score) / 4.0, 2)
        art = _art_from_are(are)

        inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
        if worst_proc_internal_id:
            cursor.execute(
                sql.SQL("""
                    SELECT type_of_risk, risk_classification, risk_classification_score
                    FROM {risk_table}
                    WHERE agent_internal_id = %s
                      AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ORDER BY created_ts DESC
                """).format(risk_table=sql.Identifier(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")),
                (worst_proc_internal_id,),
            )
            for tor, rc, rcs in cursor.fetchall():
                if tor == "Inherent Risk" and not inherent_class:
                    inherent_class = rc or ""
                    inherent_score = float(rcs or 0.0)
                elif tor == "Residual Risk" and not residual_class:
                    residual_class = rc or ""
                    residual_score = float(rcs or 0.0)

        cursor.execute(
            sql.SQL("""
                UPDATE {bp}
                SET blended_risk_score = %s,
                    agent_risk_exposure = %s,
                    agent_risk_tier     = %s,
                    inherent_risk_classification = %s,
                    inherent_risk_classification_score = %s,
                    residual_risk_classification = %s,
                    residual_risk_classification_score = %s,
                    updated_ts          = NOW()
                WHERE business_process_id = %s
            """).format(bp=sql.Identifier(CORE_SCHEMA, "business_processes")),
            (max_brs, are, art, inherent_class, inherent_score, residual_class, residual_score, proc_id),
        )

    # AI use cases
    cursor.execute(
        sql.SQL("""
            SELECT DISTINCT ai_use_case_id
            FROM {link}
            WHERE agent_id = %s OR agent_internal_id = %s
        """).format(link=sql.Identifier(CORE_SCHEMA, "agent_ai_use_cases")),
        (agent_id, agent_internal_id),
    )
    for row in cursor.fetchall():
        use_case_id = row[0]

        cursor.execute(
            sql.SQL("""
                SELECT COUNT(DISTINCT lnk.agent_id)
                FROM {link} lnk
                WHERE lnk.ai_use_case_id = %s
                  AND lnk.agent_id IS NOT NULL
                  AND lnk.agent_id <> ''
            """).format(link=sql.Identifier(CORE_SCHEMA, "agent_ai_use_cases")),
            (use_case_id,),
        )
        associated_count = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute(
            sql.SQL("""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {link} lnk
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {ara} ara
                    WHERE ara.blended_risk_score IS NOT NULL
                      AND (
                        ara.agent_id = lnk.agent_id
                        OR (
                            lnk.agent_internal_id IS NOT NULL
                            AND lnk.agent_internal_id <> ''
                            AND ara.agent_internal_id = lnk.agent_internal_id
                        )
                      )
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE lnk.ai_use_case_id = %s
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
            """).format(
                link=sql.Identifier(CORE_SCHEMA, "agent_ai_use_cases"),
                ara=sql.Identifier(CORE_SCHEMA, "agent_risk_assessments"),
            ),
            (use_case_id,),
        )
        worst_uc_row = cursor.fetchone()
        max_brs = float((worst_uc_row[1] if worst_uc_row else None) or 0.0)
        worst_uc_internal_id = worst_uc_row[0] if worst_uc_row else None
        are = round(max_brs, 2)
        art = _art_from_are(are) if associated_count > 0 else "None"

        inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
        if worst_uc_internal_id:
            cursor.execute(
                sql.SQL("""
                    SELECT type_of_risk, risk_classification, risk_classification_score
                    FROM {risk_table}
                    WHERE agent_internal_id = %s
                      AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ORDER BY created_ts DESC
                """).format(risk_table=sql.Identifier(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")),
                (worst_uc_internal_id,),
            )
            for tor, rc, rcs in cursor.fetchall():
                if tor == "Inherent Risk" and not inherent_class:
                    inherent_class = rc or ""
                    inherent_score = float(rcs or 0.0)
                elif tor == "Residual Risk" and not residual_class:
                    residual_class = rc or ""
                    residual_score = float(rcs or 0.0)

        cursor.execute(
            sql.SQL("""
                UPDATE {uc}
                SET blended_risk_score = %s,
                    agent_risk_exposure_are = %s,
                    agent_risk_tier_art = %s,
                    no_of_associated_agents = %s,
                    inherent_risk_classification = %s,
                    inherent_risk_classification_score = %s,
                    residual_risk_classification = %s,
                    residual_risk_classification_score = %s,
                    updated_ts = NOW()
                WHERE ai_use_case_id = %s
            """).format(uc=sql.Identifier(CORE_SCHEMA, "ai_use_cases")),
            (max_brs, are, art, associated_count, inherent_class, inherent_score, residual_class, residual_score, use_case_id),
        )

    # AI models
    cursor.execute(
        sql.SQL("""
            SELECT DISTINCT ai_model_id, business_criticality, emergency_tier
            FROM {link} lnk
            JOIN {am} am USING (ai_model_id)
            WHERE lnk.agent_id = %s OR lnk.agent_internal_id = %s
        """).format(
            link=sql.Identifier(CORE_SCHEMA, "agent_ai_models"),
            am=sql.Identifier(CORE_SCHEMA, "ai_models"),
        ),
        (agent_id, agent_internal_id),
    )
    for row in cursor.fetchall():
        model_id, bc_raw, et_raw = row

        bc = (bc_raw or "").strip().lower()
        bc_score = {"high": 1.0, "medium": 0.4, "low": 0.1}.get(bc, 0.0)

        et = (et_raw or "").strip().lower()
        et_score = {"mission critical": 1.0, "business critical": 0.4,
                    "non-critical": 0.1, "non critical": 0.1}.get(et, 0.0)

        cursor.execute(
            sql.SQL("""
                SELECT COUNT(DISTINCT lnk.agent_id)
                FROM {link} lnk
                WHERE lnk.ai_model_id = %s
                  AND lnk.agent_id IS NOT NULL
                  AND lnk.agent_id <> ''
            """).format(link=sql.Identifier(CORE_SCHEMA, "agent_ai_models")),
            (model_id,),
        )
        associated_count = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute(
            sql.SQL("""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {link} lnk
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {ara} ara
                    WHERE ara.blended_risk_score IS NOT NULL
                      AND (
                        ara.agent_id = lnk.agent_id
                        OR (
                            lnk.agent_internal_id IS NOT NULL
                            AND lnk.agent_internal_id <> ''
                            AND ara.agent_internal_id = lnk.agent_internal_id
                        )
                      )
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE lnk.ai_model_id = %s
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
            """).format(
                link=sql.Identifier(CORE_SCHEMA, "agent_ai_models"),
                ara=sql.Identifier(CORE_SCHEMA, "agent_risk_assessments"),
            ),
            (model_id,),
        )
        worst_model_row = cursor.fetchone()
        max_brs = float((worst_model_row[1] if worst_model_row else None) or 0.0)
        worst_model_internal_id = worst_model_row[0] if worst_model_row else None
        are = round(max_brs * (bc_score + et_score) / 2.0, 2)
        art = _art_from_are(are) if associated_count > 0 else "None"

        inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
        if worst_model_internal_id:
            cursor.execute(
                sql.SQL("""
                    SELECT type_of_risk, risk_classification, risk_classification_score
                    FROM {risk_table}
                    WHERE agent_internal_id = %s
                      AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ORDER BY created_ts DESC
                """).format(risk_table=sql.Identifier(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")),
                (worst_model_internal_id,),
            )
            for tor, rc, rcs in cursor.fetchall():
                if tor == "Inherent Risk" and not inherent_class:
                    inherent_class = rc or ""
                    inherent_score = float(rcs or 0.0)
                elif tor == "Residual Risk" and not residual_class:
                    residual_class = rc or ""
                    residual_score = float(rcs or 0.0)

        cursor.execute(
            sql.SQL("""
                UPDATE {am}
                SET blended_risk_score = %s,
                    agent_risk_exposure = %s,
                    agent_risk_tier = %s,
                    no_of_associated_agents = %s,
                    inherent_risk_classification = %s,
                    inherent_risk_classification_score = %s,
                    residual_risk_classification = %s,
                    residual_risk_classification_score = %s,
                    updated_ts = NOW()
                WHERE ai_model_id = %s
            """).format(am=sql.Identifier(CORE_SCHEMA, "ai_models")),
            (max_brs, are, art, associated_count, inherent_class, inherent_score, residual_class, residual_score, model_id),
        )

    # Integrations
    cursor.execute(
        sql.SQL("""
            SELECT DISTINCT bi.integration_id,
                   bi.business_criticality,
                   bi.emergency_tier
            FROM {link} lnk
            JOIN {bi} bi USING (integration_id)
            WHERE lnk.agent_id = %s OR lnk.agent_internal_id = %s
        """).format(
            link=sql.Identifier(CORE_SCHEMA, "agent_business_integrations"),
            bi=sql.Identifier(CORE_SCHEMA, "business_integrations"),
        ),
        (agent_id, agent_internal_id),
    )
    for row in cursor.fetchall():
        integration_id, bc_raw, et_raw = row

        bc = (bc_raw or "").strip().lower()
        bc_score = {"high": 1.0, "medium": 0.4, "low": 0.1}.get(bc, 0.0)

        et = (et_raw or "").strip().lower()
        et_score = {"mission critical": 1.0, "business critical": 0.4,
                    "non-critical": 0.1, "non critical": 0.1}.get(et, 0.0)

        cursor.execute(
            sql.SQL("""
                SELECT COUNT(DISTINCT lnk.agent_id)
                FROM {link} lnk
                WHERE lnk.integration_id = %s
                  AND lnk.agent_id IS NOT NULL
                  AND lnk.agent_id <> ''
            """).format(link=sql.Identifier(CORE_SCHEMA, "agent_business_integrations")),
            (integration_id,),
        )
        associated_count = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute(
            sql.SQL("""
                SELECT brs.agent_internal_id, brs.blended_risk_score
                FROM {link} lnk
                JOIN LATERAL (
                    SELECT ara.agent_internal_id, ara.blended_risk_score
                    FROM {ara} ara
                    WHERE ara.blended_risk_score IS NOT NULL
                      AND (
                        ara.agent_id = lnk.agent_id
                        OR (
                            lnk.agent_internal_id IS NOT NULL
                            AND lnk.agent_internal_id <> ''
                            AND ara.agent_internal_id = lnk.agent_internal_id
                        )
                      )
                    ORDER BY
                        CASE WHEN ara.is_current = TRUE THEN 0 ELSE 1 END,
                        ara.assessment_ts DESC NULLS LAST,
                        ara.updated_ts DESC NULLS LAST
                    LIMIT 1
                ) brs ON TRUE
                WHERE lnk.integration_id = %s
                ORDER BY brs.blended_risk_score DESC NULLS LAST
                LIMIT 1
            """).format(
                link=sql.Identifier(CORE_SCHEMA, "agent_business_integrations"),
                ara=sql.Identifier(CORE_SCHEMA, "agent_risk_assessments"),
            ),
            (integration_id,),
        )
        worst_int_row = cursor.fetchone()
        max_brs = float((worst_int_row[1] if worst_int_row else None) or 0.0)
        worst_int_internal_id = worst_int_row[0] if worst_int_row else None
        are = round(max_brs * (bc_score + et_score) / 2.0, 2)
        art = _art_from_are(are) if associated_count > 0 else "None"

        inherent_class, inherent_score, residual_class, residual_score = "", 0.0, "", 0.0
        if worst_int_internal_id:
            cursor.execute(
                sql.SQL("""
                    SELECT type_of_risk, risk_classification, risk_classification_score
                    FROM {risk_table}
                    WHERE agent_internal_id = %s
                      AND type_of_risk IN ('Inherent Risk', 'Residual Risk')
                    ORDER BY created_ts DESC
                """).format(risk_table=sql.Identifier(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")),
                (worst_int_internal_id,),
            )
            for tor, rc, rcs in cursor.fetchall():
                if tor == "Inherent Risk" and not inherent_class:
                    inherent_class = rc or ""
                    inherent_score = float(rcs or 0.0)
                elif tor == "Residual Risk" and not residual_class:
                    residual_class = rc or ""
                    residual_score = float(rcs or 0.0)

        cursor.execute(
            sql.SQL("""
                UPDATE {bi}
                SET blended_risk_score = %s,
                    agent_risk_exposure = %s,
                    agent_risk_tier = %s,
                    num_of_associated_agents = %s,
                    inherent_risk_classification = %s,
                    inherent_risk_classification_score = %s,
                    residual_risk_classification = %s,
                    residual_risk_classification_score = %s,
                    updated_ts = NOW()
                WHERE integration_id = %s
            """).format(bi=sql.Identifier(CORE_SCHEMA, "business_integrations")),
            (max_brs, are, art, associated_count, inherent_class, inherent_score, residual_class, residual_score, integration_id),
        )


def insert_core_risk_assessment(
    agent_internal_id: str,
    agent_id:          str,
    risk_assessment_id: str,
    aars_score:        float,
    cvss_result:       dict,
    risk_classification: str,
    created_ts:        str,
    tenant_id:         str = None,
) -> None:
    """
    Insert a completed assessment snapshot into core.agent_risk_assessments.
    Computes blended risk, aivss, and regulatory risk entirely in Python.
    """
    tenant_id  = _normalize_tenant_id(tenant_id)
    created_at = (
        datetime.strptime(created_ts, "%Y-%m-%d %H:%M:%S")
        if isinstance(created_ts, str)
        else created_ts
    )

    # Derived scores (all computed in Python, not in SQL)
    cvss_score            = max(cvss_result["CVSS Numeric"].values())
    aivss_score           = round((cvss_score + aars_score) / 2, 2)
    regulatory_risk_score = _regulatory_risk_score(risk_classification)
    blended_risk_score    = round((0.8 * aivss_score) + (regulatory_risk_score * 0.2), 2)
    blended_risk_class    = _blended_risk_class(blended_risk_score)
    aivss_class_val       = _aivss_class(aivss_score)
    regulatory_risk_class = risk_classification

    assessment_name = get_assessment_name(risk_assessment_id)

    print(
        f"[{CORE_SCHEMA}] Inserting risk_assessment_id={risk_assessment_id} "
        f"agent_internal_id={agent_internal_id} blended={blended_risk_score} ({blended_risk_class}) "
        f"aivss={aivss_score} regulatory={regulatory_risk_score}"
    )

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            _lock_agent_assessment(cursor, agent_internal_id, tenant_id)

            # Fetch company_id from risk_management.agent_risk_assessment
            cursor.execute(
                sql.SQL("SELECT company_id FROM {risk_table} WHERE assessment_id = %s LIMIT 1").format(
                    risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")
                ),
                (risk_assessment_id,),
            )
            _row = cursor.fetchone()
            company_id = _row[0] if _row else None

            values = (
                risk_assessment_id,
                agent_internal_id,
                agent_id,
                tenant_id,
                company_id,
                assessment_name,
                "Admin",
                created_at,
                blended_risk_score,
                blended_risk_class,
                aivss_score,
                aivss_class_val,
                regulatory_risk_score,
                regulatory_risk_class,
                "Completed",
                True,
                created_at,
                created_at,
            )

            update_query = sql.SQL(
                """
                UPDATE {core_table}
                SET
                    agent_internal_id = %s,
                    agent_id = %s,
                    tenant_id = %s,
                    company_id = %s,
                    assessment_name = %s,
                    assessor_name = %s,
                    assessment_ts = %s,
                    blended_risk_score = %s,
                    blended_risk_class = %s,
                    aivss_score = %s,
                    aivss_class = %s,
                    regulatory_risk_score = %s,
                    regulatory_risk_class = %s,
                    state_name = %s,
                    is_current = %s,
                    updated_ts = %s
                WHERE risk_assessment_id = %s
                  AND (%s IS NULL OR tenant_id = %s)
                """
            ).format(core_table=_table(CORE_SCHEMA, "agent_risk_assessments"))

            update_values = (
                agent_internal_id,
                agent_id,
                tenant_id,
                company_id,
                assessment_name,
                "Admin",
                created_at,
                blended_risk_score,
                blended_risk_class,
                aivss_score,
                aivss_class_val,
                regulatory_risk_score,
                regulatory_risk_class,
                "Completed",
                True,
                created_at,
                risk_assessment_id,
                tenant_id,
                tenant_id,
            )
            print(cursor.mogrify(update_query, update_values).decode())
            cursor.execute(update_query, update_values)
            updated = bool(cursor.rowcount)
            if updated:
                print(f"[{CORE_SCHEMA}] Updated existing risk_assessment_id={risk_assessment_id}")

            if not updated:
                query = sql.SQL(
                    """
                    INSERT INTO {core_table} (
                        risk_assessment_id,
                        agent_internal_id,
                        agent_id,
                        tenant_id,
                        company_id,
                        assessment_name,
                        assessor_name,
                        assessment_ts,
                        blended_risk_score,
                        blended_risk_class,
                        aivss_score,
                        aivss_class,
                        regulatory_risk_score,
                        regulatory_risk_class,
                        state_name,
                        is_current,
                        created_ts,
                        updated_ts
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                ).format(core_table=_table(CORE_SCHEMA, "agent_risk_assessments"))

                print(cursor.mogrify(query, values).decode())
                cursor.execute(query, values)

            try:
                _refresh_are_for_agent(cursor, agent_id, agent_internal_id, tenant_id)
            except Exception as exc:
                print(f"[{CORE_SCHEMA}] WARNING: ARE rollup failed for agent {agent_id}: {exc}")


# ---------------------------------------------------------------------------
# Sensitivity flags  (core.agent_data_sources)
# ---------------------------------------------------------------------------

def update_agent_data_sensitivity_flags(
    agent_internal_id:                   str,
    agent_id:                            str,
    personally_identifiable_information: str,
    protected_health_information:        str,
    payment_card_industry:               str,
    tenant_id:                           str = None,
) -> None:
    """Update PII / PHI / PCI boolean flags on the agent's data-source rows."""
    tenant_id = _normalize_tenant_id(tenant_id)

    def _to_bool(value: str) -> bool:
        return str(value).strip().lower() == "yes"

    contains_pii = _to_bool(personally_identifiable_information)
    contains_phi = _to_bool(protected_health_information)
    contains_pci = _to_bool(payment_card_industry)

    print(
        f"[{CORE_SCHEMA}] Updating sensitivity flags for agent_internal_id={agent_internal_id} "
        f"PII={contains_pii} PHI={contains_phi} PCI={contains_pci}"
    )

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            query = sql.SQL(
                """
                UPDATE {data_sources_table}
                SET
                    contains_pii = %s,
                    contains_phi = %s,
                    contains_pci = %s,
                    updated_ts   = CURRENT_TIMESTAMP
                WHERE agent_internal_id = %s
                  AND (
                        (source_object_type = 'Agent' AND source_object_id = %s)
                        OR
                        (target_object_type = 'Agent' AND target_object_id = %s)
                      )
                  AND (%s IS NULL OR tenant_id = %s)
                """
            ).format(data_sources_table=_table(CORE_SCHEMA, "agent_data_sources"))

            print(cursor.mogrify(query, (
                contains_pii,
                contains_phi,
                contains_pci,
                agent_internal_id,
                agent_id,
                agent_id,
                tenant_id, tenant_id,
            )).decode())
            cursor.execute(
                query,
                (
                    contains_pii,
                    contains_phi,
                    contains_pci,
                    agent_internal_id,
                    agent_id,
                    agent_id,
                    tenant_id, tenant_id,
                ),
            )


# ---------------------------------------------------------------------------
# Summary  (updates both core and risk_management tables)
# ---------------------------------------------------------------------------

def insert_summary_to_tables(
    agent_internal_id: str,
    assessment_id: str,
    summary: str,
    tenant_id: str = None,
) -> None:

    tenant_id = _normalize_tenant_id(tenant_id)

    if summary is None:
        raise RuntimeError("Summary text is None; cannot persist empty summary.")

    with _db_connection() as connection:
        with connection.cursor() as cursor:

            # ─────────────────────────────────────────────
            # CORE UPDATE
            # ─────────────────────────────────────────────
            core_update_query = sql.SQL(
                """
                UPDATE {core_table}
                SET
                    summary = %s,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE agent_internal_id = %s
                  AND risk_assessment_id = %s
                  AND (%s IS NULL OR tenant_id = %s)
                """
            ).format(
                core_table=_table(CORE_SCHEMA, "agent_risk_assessments")
            )

            print(cursor.mogrify(core_update_query, (summary, agent_internal_id, assessment_id, tenant_id, tenant_id)).decode())
            cursor.execute(
                core_update_query,
                (summary, agent_internal_id, assessment_id, tenant_id, tenant_id),
            )

            if cursor.rowcount == 0:
                raise RuntimeError(
                    f"Core update failed for agent_internal_id={agent_internal_id}, "
                    f"assessment_id={assessment_id}"
                )

            # ─────────────────────────────────────────────
            # RISK MANAGEMENT UPDATE
            # ─────────────────────────────────────────────
            rm_update_query = sql.SQL(
                """
                UPDATE {risk_table}
                SET
                    summary = %s,
                    updated_ts = CURRENT_TIMESTAMP
                WHERE agent_internal_id = %s
                  AND assessment_id = %s
                  AND (%s IS NULL OR tenant_id = %s)
                """
            ).format(
                risk_table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")
            )

            print(cursor.mogrify(rm_update_query, (summary, agent_internal_id, assessment_id, tenant_id, tenant_id)).decode())
            cursor.execute(
                rm_update_query,
                (summary, agent_internal_id, assessment_id, tenant_id, tenant_id),
            )

            if cursor.rowcount == 0:
                raise RuntimeError(
                    f"Risk management update failed for assessment_id={assessment_id}"
                )


# ---------------------------------------------------------------------------
# Curated agent-360 view refresh
# ---------------------------------------------------------------------------

def refresh_curated_agent_360(agent_internal_id: str, agent_id: str, tenant_id: str = None) -> dict:
    """
    Refresh the curated.agent_360 snapshot for a single agent:
      1. DELETE any existing rows for this agent.
      2. Re-INSERT from a live JOIN across all core tables.
    Returns row counts for observability.
    """
    tenant_id = _normalize_tenant_id(tenant_id)
    with _db_connection() as connection:
        with connection.cursor() as cursor:
            _lock_agent_assessment(cursor, agent_internal_id, tenant_id)

            delete_query = sql.SQL(
                """
                DELETE FROM {agent_360_table}
                WHERE (agent_internal_id = %s OR agent_id = %s)
                  AND (%s IS NULL OR tenant_id = %s)
                """
            ).format(agent_360_table=_table(CURATED_SCHEMA, "agent_360"))
            print(cursor.mogrify(delete_query, (agent_internal_id, agent_id, tenant_id, tenant_id)).decode())
            cursor.execute(delete_query, (agent_internal_id, agent_id, tenant_id, tenant_id))
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
                    summary,
                    company_id
                )
                SELECT
                    a.tenant_id,
                    a.agent_id,
                    a.agent_name,
                    a.agent_description,
                    cfg.autonomy_level,
                    cfg.memory_type,
                    cfg.reasoning_model,
                    COALESCE(tools.tool_count,                        0),
                    COALESCE(data_sources.data_source_count,          0),
                    COALESCE(apps.business_application_count,         0),
                    COALESCE(processes.business_process_count,        0),
                    COALESCE(models.ai_model_count,                   0),
                    primary_model.model_name,
                    primary_model.model_provider,
                    COALESCE(data_sources.contains_pii,           FALSE),
                    COALESCE(data_sources.contains_phi,           FALSE),
                    COALESCE(data_sources.contains_pci,           FALSE),
                    COALESCE(risk.blended_risk_score, risk.regulatory_risk_score),
                    COALESCE(risk.blended_risk_class, risk.regulatory_risk_class),
                    latest_event.status,
                    CURRENT_TIMESTAMP,
                    a.agent_internal_id,
                    risk.summary,
                    a.company_id
                FROM {agents_table} a
                LEFT JOIN {config_table} cfg
                    ON  cfg.agent_internal_id = a.agent_internal_id
                    AND COALESCE(cfg.is_current, TRUE) = TRUE
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS tool_count
                    FROM   {tools_table}
                    GROUP  BY agent_internal_id
                ) tools
                    ON tools.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT
                        agent_internal_id,
                        COUNT(*)::bigint                          AS data_source_count,
                        BOOL_OR(COALESCE(contains_pii, FALSE))   AS contains_pii,
                        BOOL_OR(COALESCE(contains_phi, FALSE))   AS contains_phi,
                        BOOL_OR(COALESCE(contains_pci, FALSE))   AS contains_pci
                    FROM   {data_sources_table}
                    GROUP  BY agent_internal_id
                ) data_sources
                    ON data_sources.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS business_application_count
                    FROM   {applications_table}
                    GROUP  BY agent_internal_id
                ) apps
                    ON apps.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS business_process_count
                    FROM   {processes_table}
                    GROUP  BY agent_internal_id
                ) processes
                    ON processes.agent_internal_id = a.agent_internal_id
                LEFT JOIN (
                    SELECT agent_internal_id, COUNT(*)::bigint AS ai_model_count
                    FROM   {models_table}
                    GROUP  BY agent_internal_id
                ) models
                    ON models.agent_internal_id = a.agent_internal_id
                LEFT JOIN LATERAL (
                    SELECT
                        COALESCE(cat.model_name, rel.model_name) AS model_name,
                        cat.provider                             AS model_provider
                    FROM   {models_table} rel
                    LEFT JOIN {models_catalog_table} cat
                        ON LOWER(TRIM(cat.ai_model_id)) = LOWER(TRIM(rel.ai_model_id))
                    WHERE  rel.agent_internal_id = a.agent_internal_id
                    ORDER  BY rel.created_ts DESC NULLS LAST
                    LIMIT  1
                ) primary_model ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                        blended_risk_score,
                        blended_risk_class,
                        regulatory_risk_score,
                        regulatory_risk_class,
                        state_name,
                        summary
                    FROM   {risk_table} r
                    WHERE  r.agent_internal_id = a.agent_internal_id
                    ORDER  BY r.assessment_ts DESC NULLS LAST,
                              r.updated_ts    DESC NULLS LAST
                    LIMIT  1
                ) risk ON TRUE
                LEFT JOIN LATERAL (
                    SELECT status
                    FROM   {governance_events_table} ge
                    WHERE  ge.agent_internal_id = a.agent_internal_id
                    ORDER  BY ge.event_ts    DESC NULLS LAST,
                              ge.created_ts  DESC NULLS LAST
                    LIMIT  1
                ) latest_event ON TRUE
                WHERE a.agent_internal_id = %s
                  AND COALESCE(a.is_current, TRUE) = TRUE
                  AND (%s IS NULL OR a.tenant_id = %s)
                """
            ).format(
                agent_360_table         = _table(CURATED_SCHEMA, "agent_360"),
                agents_table            = _table(CORE_SCHEMA,    "agents"),
                config_table            = _table(CORE_SCHEMA,    "agent_configurations"),
                tools_table             = _table(CORE_SCHEMA,    "agent_tools"),
                data_sources_table      = _table(CORE_SCHEMA,    "agent_data_sources"),
                applications_table      = _table(CORE_SCHEMA,    "agent_business_applications"),
                processes_table         = _table(CORE_SCHEMA,    "agent_business_processes"),
                models_table            = _table(CORE_SCHEMA,    "agent_ai_models"),
                models_catalog_table    = _table(CORE_SCHEMA,    "ai_models"),
                governance_events_table = _table(CORE_SCHEMA,    "agent_governance_events"),
                risk_table              = _table(CORE_SCHEMA,    "agent_risk_assessments"),
            )
            print(cursor.mogrify(insert_query, (agent_internal_id, tenant_id, tenant_id)).decode())
            cursor.execute(insert_query, (agent_internal_id, tenant_id, tenant_id))
            inserted_rows = cursor.rowcount

    return {
        "agent_internal_id": agent_internal_id,
        "agent_id":          agent_id,
        "tenant_id":         tenant_id,
        "deleted_rows":      deleted_rows,
        "inserted_rows":     inserted_rows,
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


def _query_agent_application_rows(cursor, agent_internal_id: str):
    query = sql.SQL(
        """
        SELECT
            aba.business_application_id,
            COALESCE(ba.application_name, aba.application_name) AS application_name,
            ba.application_description                           AS description,
            COALESCE(ba.business_criticality, aba.criticality)  AS criticality,
            ba.emergency_tier                                    AS emergency_tier
        FROM {} aba
        LEFT JOIN {} ba
            ON ba.business_application_id = aba.business_application_id
        WHERE aba.agent_internal_id = %s
        """
    ).format(
        _table(CORE_SCHEMA, "agent_business_applications"),
        _table(CORE_SCHEMA, "business_applications"),
    )
    cursor.execute(query, (agent_internal_id,))
    rows = cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def _query_agent_process_rows(cursor, agent_internal_id: str):
    query = sql.SQL(
        """
        SELECT
            abp.business_process_id,
            COALESCE(bp.process_name, abp.process_name)          AS process_name,
            bp.process_description                               AS description,
            COALESCE(bp.business_criticality, abp.criticality)   AS criticality,
            bp.parent_process_id                                 AS parent_process_id,
            rel.related_process_ids                              AS related_process_ids
        FROM {} abp
        LEFT JOIN {} bp
            ON bp.business_process_id = abp.business_process_id
        LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(rel_id ORDER BY rel_id) AS related_process_ids
            FROM (
                SELECT bp.parent_process_id AS rel_id
                WHERE bp.parent_process_id IS NOT NULL
                UNION
                SELECT child.business_process_id AS rel_id
                FROM {} child
                WHERE child.parent_process_id = abp.business_process_id
            ) rel
        ) rel ON TRUE
        WHERE abp.agent_internal_id = %s
        """
    ).format(
        _table(CORE_SCHEMA, "agent_business_processes"),
        _table(CORE_SCHEMA, "business_processes"),
        _table(CORE_SCHEMA, "business_processes"),
    )
    cursor.execute(query, (agent_internal_id,))
    rows = cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in rows]

def create_local_agent_card(agent_internal_id: str, output_dir: str = None):
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
    ]

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            data = {name: _query_core_rows(cursor, name, agent_internal_id) for name in table_names}
            application_rows = _query_agent_application_rows(cursor, agent_internal_id)
            process_rows = _query_agent_process_rows(cursor, agent_internal_id)
            # Query latest risk assessment separately with explicit ordering so the
            # most recent completed assessment is always written to the card file.
            ra_query = sql.SQL(
                """
                SELECT * FROM {}
                WHERE agent_internal_id = %s
                ORDER BY updated_ts DESC NULLS LAST, created_ts DESC NULLS LAST
                LIMIT 1
                """
            ).format(_table(CORE_SCHEMA, "agent_risk_assessments"))
            cursor.execute(ra_query, (agent_internal_id,))
            ra_rows = cursor.fetchall()
            ra_columns = [d[0] for d in cursor.description] if cursor.description else []
            data["agent_risk_assessments"] = [dict(zip(ra_columns, row)) for row in ra_rows]

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
    apps = application_rows
    ai_models = data["agent_ai_models"]
    biz_procs = process_rows
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
        "preferredTransport": _val(ag, "preferred_transport"),
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
        "supports_authenticated_extended_card": _val(ag, "supports_auth_ext_card"),
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
