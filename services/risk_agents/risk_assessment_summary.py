import os
import json
import psycopg2
from psycopg2 import sql
from datetime import datetime
from utils.db import db_connection as _db_connection
from contextlib import contextmanager

CORE_SCHEMA = os.getenv("CORE_DB_NAME", "core")
RISK_MANAGEMENT_SCHEMA = os.getenv("RISK_MANAGEMENT_DB_NAME", "risk_management")

def _table(schema_name: str, table_name: str) -> sql.Composed:
    return sql.SQL("{}.{}").format(sql.Identifier(schema_name), sql.Identifier(table_name))

# ---------------------------------------------------------------------------
# Data Fetching Functions (Converted from Athena to Postgres)
# ---------------------------------------------------------------------------

def get_agent_core_info(cursor, agent_internal_id: str) -> list[dict]:
    query = sql.SQL("SELECT * FROM {table} WHERE agent_internal_id = %s").format(
        table=_table(CORE_SCHEMA, "agents")
    )
    cursor.execute(query, (agent_internal_id,))
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]

def get_agent_risk_assessments_core(cursor, agent_internal_id: str) -> list[dict]:
    query = sql.SQL("SELECT * FROM {table} WHERE agent_internal_id = %s").format(
        table=_table(CORE_SCHEMA, "agent_risk_assessments")
    )
    cursor.execute(query, (agent_internal_id,))
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]

def get_agent_risk_assessment_detail(cursor, agent_internal_id: str, assessment_id: str) -> list[dict]:
    query = sql.SQL("SELECT * FROM {table} WHERE agent_internal_id = %s AND assessment_id = %s").format(
        table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_assessment")
    )
    cursor.execute(query, (agent_internal_id, assessment_id))
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]

def get_agent_risk_scenarios(cursor, assessment_id: str) -> list[dict]:
    query = sql.SQL("SELECT * FROM {table} WHERE assessment_id = %s").format(
        table=_table(RISK_MANAGEMENT_SCHEMA, "agent_risk_scenarios")
    )
    cursor.execute(query, (assessment_id,))
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]
 
 
# ─────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────
def risk_summary_agent(internal_id: str, assessment_id: str) -> str:
    """
    Collects risk-related data from Postgres within a single transaction
    and returns a formatted summary string.
    """
    print(f"[risk_summary_agent] Fetching transactional data for "
          f"agent_internal_id={internal_id}, assessment_id={assessment_id}")

    with _db_connection() as connection:
        with connection.cursor() as cursor:
            core_agent_info = get_agent_core_info(cursor, internal_id)
            core_risk_assessments = get_agent_risk_assessments_core(cursor, internal_id)
            risk_assessment_detail = get_agent_risk_assessment_detail(cursor, internal_id, assessment_id)
            risk_scenarios = get_agent_risk_scenarios(cursor, assessment_id)

    print(
        f"[risk_summary_agent] fetched rows core_agent_info={len(core_agent_info)} "
        f"core_risk_assessments={len(core_risk_assessments)} "
        f"risk_assessment_detail={len(risk_assessment_detail)} "
        f"risk_scenarios={len(risk_scenarios)}"
    )

    data = {
        "agent_internal_id": internal_id,
        "assessment_id": assessment_id,
        "core_agent_info": core_agent_info,
        "core_risk_assessments": core_risk_assessments,
        "risk_assessment_detail": risk_assessment_detail,
        "risk_scenarios": risk_scenarios,
    }

    return generate_risk_summary(data)

# ─────────────────────────────────────────────
# Summary Generator
# ─────────────────────────────────────────────
def generate_risk_summary(data: dict) -> str:
    """
    Build a formatted risk summary string from the dict returned
    by risk_summary_agent(internal_id, assessment_id).
    """
 
    # ── Source records ──────────────────────────────────────────
    agent_info   = data["core_agent_info"][0]          if data["core_agent_info"]         else {}
    core_ra      = data["core_risk_assessments"][0]    if data["core_risk_assessments"]    else {}
    detail       = data["risk_assessment_detail"][0]   if data["risk_assessment_detail"]   else {}
    scenarios    = data["risk_scenarios"]
 
    # ── Top-level fields ────────────────────────────────────────
    agent_name       = agent_info.get("agent_name")
    agent_version    = agent_info.get("protocol_version")
    agent_owner      = core_ra.get("assessor_name", detail.get("assessor"))
    risk_class       = detail.get("risk_classification")
    aivss_score      = core_ra.get("aivss_score")
    aivss_class      = core_ra.get("aivss_class")
    aars_score       = detail.get("aars_score")
    scenario_cvss_scores = []
    for scenario in scenarios:
        try:
            scenario_cvss_scores.append(float(scenario.get("cvss_score")))
        except (TypeError, ValueError):
            pass
    cvss_score = f"{max(scenario_cvss_scores):.2f}".rstrip("0").rstrip(".") if scenario_cvss_scores else "N/A"
 
    pii              = detail.get("personally_identifiable_information")
    phi              = detail.get("protected_health_information")
    pci              = detail.get("payment_card_industry")
    rc_rationale     = detail.get("risk_classification_rationale")
 
    # ── EU AI Act Article 5 & 6 ─────────────────────────────────
    art5_raw = detail.get("eu_ai_act_article_5_prohibited_ai_practices_evaluation")
    art6_raw = detail.get("eu_ai_act_article_6_high_risk_ai_systems_evaluation")
    try:
        art5 = json.loads(art5_raw) if isinstance(art5_raw, str) else art5_raw or {}
    except Exception:
        art5 = {}
    try:
        art6 = json.loads(art6_raw) if isinstance(art6_raw, str) else art6_raw or {}
    except Exception:
        art6 = {}
 
    # ── AIVSS Capability fields ──────────────────────────────────
    CAPABILITIES = [
        ("Autonomy of Action",       "autonomy_of_action",       "autonomy_of_action_rationale"),
        ("Contextual Awareness",     "contextual_awareness",     "contextual_awareness_rationale"),
        ("Dynamic Identity",         "dynamic_identity",         "dynamic_identity_rationale"),
        ("Dynamic Tool Use",         "dynamic_tool_use",         "dynamic_tool_use_rationale"),
        ("Goal-Driven Planning",     "goal_driven_planning",     "goal_driven_planning_rationale"),
        ("Memory Use",               "memory_use",               "memory_use_rationale"),
        ("Multi-Agent Interactions", "multi_agent_interactions", "multi_agent_interactions_rationale"),
        ("Non-Determinism",          "non_determinism",          "non_determinism_rationale"),
        ("Self-Modification",        "self_modification",        "self_modification_rationale"),
        ("Opacity & Reflexivity",    "opacity_reflexivity",      "opacity_reflexivity_rationale"),
    ]
 
    # ── Helper: fixed-width text table ──────────────────────────
    def make_table(headers: list[str], rows: list[list[str]]) -> str:
        col_widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                col_widths[i] = max(col_widths[i], len(str(cell)))
 
        sep  = "+-" + "-+-".join("-" * w for w in col_widths) + "-+"
        hdr  = "| " + " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers)) + " |"
        lines = [sep, hdr, sep]
        for row in rows:
            lines.append("| " + " | ".join(str(cell).ljust(col_widths[i]) for i, cell in enumerate(row)) + " |")
        lines.append(sep)
        return "\n".join(lines)
 
    def fmt_score(score) -> str:
        try:
            return f"{float(score):.2f}"
        except (TypeError, ValueError):
            return "N/A"
        
    # ── Build AIVSS Capability table ────────────────────────────
    cap_rows = []
    for label, score_key, rationale_key in CAPABILITIES:
        score     = detail.get(score_key, "N/A")
        rationale = detail.get(rationale_key, "N/A") or "N/A"
        cap_rows.append([label, str(score), rationale])
 
    cap_table = make_table(["AARS Capability", "Score", "Rationale"], cap_rows)
 
    # ── Build Risk Scenarios table ───────────────────────────────
    scenario_rows = []
    for idx, s in enumerate(scenarios, start=1):
        risk_name       = s.get("agentic_ai_core_security_risks", "N/A")
        s_aivss         = s.get("aivss_score", "N/A")
        threat_mult     = s.get("threat_multiplier", "N/A")
        s_aars          = fmt_score(aars_score)
        scenario_rows.append([str(idx), risk_name, str(s_aivss), str(threat_mult), s_aars])
 
    scenario_table = make_table(
        ["S.No", "Risk Scenario", "AIVSS Score", "Threat Multiplier", "AARS Score"],
        scenario_rows,
    )
 
    # ── Assemble summary string ──────────────────────────────────
    summary = f"""
Agent Risk Assessment Summary
==============================
Agent Name:       {agent_name}
Agent Version:    {agent_version}
Agent Owner Name: {agent_owner}
 
The agent was assessed based on the EU AI Act and the AI Vulnerability Scoring System (AIVSS).
The agent is designated as '{risk_class}' under the EU AI Act, a classification reinforced by
an AIVSS score of {aivss_score}/10, placing it in the '{aivss_class} Risk' category.
A detailed breakdown of the assessment is provided in the following sections.
 
==============================
Regulatory Risk Summary
==============================
This is the classification of the agent based on the EU AI Act:
 
Risk Classification:                    {risk_class}
Personally Identifiable Information:    {pii}
Protected Health Information:           {phi}
Payment Card Industry:                  {pci}
 
EU AI Act Article 5 (Prohibited AI Practices) Evaluation:
  Subliminal and Manipulative Techniques:    {art5.get("Subliminal and Manipulative Techniques", "N/A")}
  Exploitation of Vulnerabilities:           {art5.get("Exploitation of Vulnerabilities", "N/A")}
  Social Scoring Systems:                    {art5.get("Social Scoring Systems", "N/A")}
  Risk Assessment for Criminal Offences:     {art5.get("Risk Assessment for Criminal Offences", "N/A")}
  Facial Recognition Database Creation:      {art5.get("Facial Recognition Database Creation", "N/A")}
  Emotion Inference in Workplace/Education:  {art5.get("Emotion Inference in Workplace and Education", "N/A")}
  Biometric Categorisation:                  {art5.get("Biometric Categorisation", "N/A")}
  Real-Time Remote Biometric Identification: {art5.get("Real-Time Remote Biometric Identification", "N/A")}
 
EU AI Act Article 6 (High-Risk AI Systems) Evaluation:
  Biometrics:                                                          {art6.get("Biometrics", "N/A")}
  Critical Infrastructure:                                             {art6.get("Critical Infrastructure", "N/A")}
  Education and Vocational Training:                                   {art6.get("Education and Vocational Training", "N/A")}
  Employment, Workers' Management and Access to Self-Employment:       {art6.get("Employment, Workers’ Management and Access to Self-Employment", "N/A")}
  Access to Essential Private/Public Services and Benefits:            {art6.get("Access to and Enjoyment of Essential Private Services and Essential Public Services and Benefits", "N/A")}
  Law Enforcement:                                                     {art6.get("Law Enforcement", "N/A")}
  Migration, Asylum and Border Control Management:                     {art6.get("Migration, Asylum and Border Control Management", "N/A")}
  Administration of Justice and Democratic Processes:                  {art6.get("Administration of Justice and Democratic Processes", "N/A")}
  Safety Component of a Product:                                       {art6.get("Safety Component of a Product", "N/A")}
  Medical Devices:                                                     {art6.get("Medical Devices", "N/A")}
  In Vitro Diagnostic Medical Devices:                                 {art6.get("In Vitro Diagnostic Medical Devices", "N/A")}
  Other High Risk Items:                                               {art6.get("Other High Risk Items", "N/A")}
 
Risk Classification Rationale:
{rc_rationale}
 
==============================
OWASP AIVSS Summary
==============================
OWASP Agentic AI Risk Score (AARS) Capability Summary:
AIVSS Score for {agent_name}: {aivss_score}
AARS Score: {aars_score}
 
{cap_table}
 
==============================
OWASP Agent Risk Scenario Summary
==============================
Agent Risk Scenario Summary
The following OWASP Scenario-Level Risks were assessed:
 
{scenario_table}
""".strip()
 
    return summary
 
# ─────────────────────────────────────────────
# Quick test
# ─────────────────────────────────────────────
# if __name__ == "__main__":
#     result = risk_summary_agent(
#         internal_id="35e99a65-0484-4ead-bbcf-2a491b989753",
#         assessment_id="c0cb978c-a2bc-480c-bae4-fb1d8ad0ac15",
#     )
#     # print(json.dumps(result, indent=2, default=str))
#     # summary_str = generate_risk_summary(result)
#     print(result)