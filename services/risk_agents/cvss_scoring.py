import os
from typing import Literal
from pathlib import Path
from crewai import Agent, Task, Crew, Process
from crewai_tools import TXTSearchTool
from services.db.db_functions import calculate_cvss_score, generate_cvss_vector
from services.risk_agents.llm_config import get_crewai_llm
from pydantic import BaseModel
from utils.set_environment import set_environment

DEFAULT_TXT_SEARCH_EMBEDDER = "onnx"


# ---------- CVSS 4.0 Base Metrics schema ----------

class CVSSMetrics(BaseModel):
    attack_vector_av:                       Literal["N", "A", "L", "P"] = "N"
    attack_complexity_ac:                   Literal["L", "H"]           = "L"
    attack_requirements_at:                 Literal["P", "N"]           = "P"
    privileges_required_pr:                 Literal["L", "N", "H"]      = "L"
    user_interaction_ui:                    Literal["P", "N", "A"]      = "P"
    vulnerable_system_confidentiality_vc:   Literal["L", "H", "N"]      = "L"
    vulnerable_system_integrity_vi:         Literal["L", "H", "N"]      = "L"
    vulnerable_system_availability_va:      Literal["L", "H", "N"]      = "L"
    subsequent_system_confidentiality_sc:   Literal["L", "H", "N"]      = "L"
    subsequent_system_integrity_si:         Literal["L", "H", "N"]      = "L"
    subsequent_system_availability_sa:      Literal["L", "H", "N"]      = "L"


# ---------- Top-level output schema ----------

class CVSSScoringOutput(BaseModel):
    agentic_ai_tool_misuse:                            CVSSMetrics = CVSSMetrics()
    agent_access_control_violation:                    CVSSMetrics = CVSSMetrics()
    agent_cascading_failures:                          CVSSMetrics = CVSSMetrics()
    agent_orchestration_and_multi_agent_exploitation:  CVSSMetrics = CVSSMetrics()
    agent_identity_impersonation:                      CVSSMetrics = CVSSMetrics()
    agent_memory_and_context_manipulation:             CVSSMetrics = CVSSMetrics()
    insecure_agent_critical_systems_interaction:       CVSSMetrics = CVSSMetrics()
    agent_supply_chain_and_dependency_attacks:         CVSSMetrics = CVSSMetrics()
    agent_untraceability:                              CVSSMetrics = CVSSMetrics()
    agent_goal_and_instruction_manipulation:           CVSSMetrics = CVSSMetrics()

    overall_risk_summary: str = ""


# ---------- Risk key → display label mapping ----------

RISK_KEYS = [
    ("agentic_ai_tool_misuse",                           "Agentic AI Tool Misuse"),
    ("agent_access_control_violation",                   "Agent Access Control Violation"),
    ("agent_cascading_failures",                         "Agent Cascading Failures"),
    ("agent_orchestration_and_multi_agent_exploitation", "Agent Orchestration and Multi-Agent Exploitation"),
    ("agent_identity_impersonation",                     "Agent Identity Impersonation"),
    ("agent_memory_and_context_manipulation",            "Agent Memory and Context Manipulation"),
    ("insecure_agent_critical_systems_interaction",      "Insecure Agent Critical Systems Interaction"),
    ("agent_supply_chain_and_dependency_attacks",        "Agent Supply Chain and Dependency Attacks"),
    ("agent_untraceability",                             "Agent Untraceability"),
    ("agent_goal_and_instruction_manipulation",          "Agent Goal and Instruction Manipulation"),
]


# ---------- Helper: build flat vector-string output ----------

def _extract_vector(risk_data: dict, baseline_vector: str) -> str:
    """
    Return the CVSS vector string for a single risk.
    Prefers the LLM-returned cvss_vector_string; falls back to
    reconstructing it from the individual metric fields.
    """
    if not isinstance(risk_data, dict):
        return baseline_vector

    try:
        return generate_cvss_vector(
            attack_vector_av = risk_data.get("attack_vector_av", "N"),
            attack_complexity_ac = risk_data.get("attack_complexity_ac", "L"),
            attack_requirements_at = risk_data.get("attack_requirements_at", "P"),
            privileges_required_pr = risk_data.get("privileges_required_pr", "L"),
            user_interaction_ui = risk_data.get("user_interaction_ui", "P"),
            vulnerable_system_confidentiality_vc = risk_data.get("vulnerable_system_confidentiality_vc", "L"),
            vulnerable_system_integrity_vi = risk_data.get("vulnerable_system_integrity_vi", "L"),
            vulnerable_system_availability_va = risk_data.get("vulnerable_system_availability_va", "L"),
            subsequent_system_confidentiality_sc = risk_data.get("subsequent_system_confidentiality_sc", "L"),
            subsequent_system_integrity_si = risk_data.get("subsequent_system_integrity_si", "L"),
            subsequent_system_availability_sa = risk_data.get("subsequent_system_availability_sa", "L"),
        )
    except Exception:
        return baseline_vector


def _build_output(result_data: dict, agent_name: str, agent_description: str, baseline_vector: str, pii: str, phi: str, pci: str) -> dict:

    cvss_scores = {
        label: _extract_vector(result_data.get(key, {}), baseline_vector)
        for key, label in RISK_KEYS
    }

    cvss_numeric = {
        label: calculate_cvss_score(vector)
        for label, vector in cvss_scores.items()
    }

    return {
        "Agent Name"                          : agent_name,
        "Description"                         : agent_description,
        "Personally Identifiable Information" : pii,
        "Protected Health Information"        : phi,
        "Payment Card Industry"               : pci,
        # ── Primary output — flat {risk: vector_string} ──────────────
        "CVSS Scores"  : cvss_scores,
        # ── Numeric scores alongside for convenience ──────────────────
        "CVSS Numeric" : cvss_numeric,
        "Overall Data": result_data,
        "Overall Risk Summary": result_data.get("overall_risk_summary", ""),
    }


# ---------- Main function ----------

def score_cvss(agent_name: str, agent_description: str, agent_instructions: str, personally_identifiable_information: str = "No", protected_health_information: str = "No", payment_card_industry: str = "No") -> dict:
    """
    Score an AI agent against the 10 OWASP Agentic AI Core Security Risks
    using the CVSS 4.0 Base framework.

    Returns
    -------
    dict  with a 'CVSS Scores' key shaped as:
        {
            "Agentic AI Tool Misuse":                            "CVSS:4.0/AV:N/AC:L/...",
            "Agent Access Control Violation":                    "CVSS:4.0/AV:N/AC:L/...",
            "Agent Cascading Failures":                          "CVSS:4.0/AV:N/AC:L/...",
            "Agent Orchestration and Multi-Agent Exploitation":  "CVSS:4.0/AV:N/AC:L/...",
            "Agent Identity Impersonation":                      "CVSS:4.0/AV:N/AC:L/...",
            "Agent Memory and Context Manipulation":             "CVSS:4.0/AV:N/AC:L/...",
            "Insecure Agent Critical Systems Interaction":       "CVSS:4.0/AV:N/AC:L/...",
            "Agent Supply Chain and Dependency Attacks":         "CVSS:4.0/AV:N/AC:L/...",
            "Agent Untraceability":                              "CVSS:4.0/AV:N/AC:L/...",
            "Agent Goal and Instruction Manipulation":           "CVSS:4.0/AV:N/AC:L/..."
        }
    """

    set_environment("secrets")
    base_path = Path(__file__).resolve().parent.parent / "skills"

    owasp_file = base_path / "OWASP Risks Scenarios.txt"
    cvss_file  = base_path / "CVSS Base Metric.txt"

    txt_search_config = {
        "embedding_model": {
            "provider": os.getenv("CREWAI_TXT_SEARCH_EMBEDDER", DEFAULT_TXT_SEARCH_EMBEDDER).strip() or DEFAULT_TXT_SEARCH_EMBEDDER,
            "config": {},
        },
    }
    owasp_tool = TXTSearchTool(
        txt=str(owasp_file),
        collection_name="owasp_risks_scenarios",
        config=txt_search_config,
    )
    cvss_tool = TXTSearchTool(
        txt=str(cvss_file),
        collection_name="cvss_base_metric",
        config=txt_search_config,
    )


    # ── Step 2 — Mechanical baseline selection ───────────────────────────
    has_sensitive_data = any(
        f.strip().lower() == "yes"
        for f in [personally_identifiable_information, protected_health_information, payment_card_industry]
    )

    if has_sensitive_data:
        baseline_vector  = "CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:P/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H"
        sensitivity_note = (
            "One or more sensitive data flags (PII/PHI/PCI) are 'Yes'. "
            "Apply HIGH-SENSITIVITY baseline to ALL 10 risks: " + baseline_vector
        )
    else:
        baseline_vector  = "CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:P/VC:L/VI:L/VA:L/SC:L/SI:L/SA:L"
        sensitivity_note = (
            "All sensitive data flags are 'No'. "
            "Apply LOW-SENSITIVITY baseline to ALL 10 risks: " + baseline_vector
        )

    # ── Agent ────────────────────────────────────────────────────────────
    cvss_agent = Agent(
        role="CVSS 4.0 AI Agent Risk Scoring Analyst",
        goal=(
            "Analyze an AI agent's metadata and independently score it against "
            "all 10 OWASP Agentic AI Core Security Risks using CVSS 4.0 Base "
            "Metrics. For each risk, determine every metric value based strictly "
            "on the provided baseline and only deviate when evidence is explicit, "
            "unambiguous, and directly tied to this specific agent. "
            "You MUST produce the same output for the same input every time — "
            "consistency and reproducibility are your highest priority."
        ),
        verbose=True,
        memory=False,
        backstory=(
            "You are a senior cybersecurity risk analyst specialised in AI system "
            "security with deep expertise in CVSS 4.0 and the OWASP Agentic AI "
            "Core Security Risks framework. "
            "Your golden rule: the baseline vector is the DEFAULT answer. "
            "You ONLY override a metric when you find a direct, named, specific "
            "piece of evidence from the OWASP or CVSS files that applies to THIS "
            "agent's exact function — not general patterns, not partial matches. "
            "If you cannot cite a specific sentence from those files to justify "
            "a change, you MUST keep the baseline value. "
            "When in doubt, keep the baseline. Always."
        ),
        tools=[owasp_tool, cvss_tool],
        llm=get_crewai_llm()
    )

    # ── Task ─────────────────────────────────────────────────────────────
    cvss_task = Task(
        description=(
            "Score the following AI agent:\n"
            "  Agent Name   : {agent_name}\n"
            "  Description  : {agent_description}\n"
            "  Instructions : {agent_instructions}\n"
            "  PII flag     : {personally_identifiable_information}\n"
            "  PHI flag     : {protected_health_information}\n"
            "  PCI flag     : {payment_card_industry}\n\n"

            "── STEP 2 — BASELINE (MECHANICAL, NO REASONING) ────────────────\n"
            f"{sensitivity_note}\n\n"

            "── STEP 3 — EVIDENCE-BASED ANALYSIS (STRICT) ───────────────────\n"
            "Read 'OWASP Risks Scenarios.txt' and 'CVSS Base Metric.txt' in full.\n"
            "For each of the 10 risks, check whether THIS agent's specific function\n"
            "directly maps to a named scenario in those files.\n\n"
            "A metric change is ONLY permitted if ALL 4 conditions are true:\n"
            "  (a) You found a specific named scenario in OWASP/CVSS files\n"
            "  (b) That scenario directly describes THIS agent's function\n"
            "  (c) The scenario explicitly supports a DIFFERENT metric value\n"
            "  (d) No ambiguity exists — only one value is supported by the text\n\n"
            "Even if all 4 conditions are met, you may ONLY change the metric if "
            "your confidence in that change is ≥ 75%. "
            "If confidence < 75% → RETAIN the baseline value. No exceptions.\n\n"
            "If ANY condition is not fully met → RETAIN the baseline value.\n"
            "If you feel uncertain for even one second → RETAIN the baseline value.\n"
            "Do NOT average, interpolate, or partially adjust any metric.\n"
            "Do NOT apply general AI risk reasoning — only file-sourced evidence.\n\n"

            "── STEP 4 — SCORE ALL 10 RISKS INDEPENDENTLY ──────────────────\n"
            "Populate all 11 CVSS 4.0 Base Metrics per risk, then set:\n"
            "Risks:\n"
            "  1. agentic_ai_tool_misuse\n"
            "  2. agent_access_control_violation\n"
            "  3. agent_cascading_failures\n"
            "  4. agent_orchestration_and_multi_agent_exploitation\n"
            "  5. agent_identity_impersonation\n"
            "  6. agent_memory_and_context_manipulation\n"
            "  7. insecure_agent_critical_systems_interaction\n"
            "  8. agent_supply_chain_and_dependency_attacks\n"
            "  9. agent_untraceability\n"
            " 10. agent_goal_and_instruction_manipulation\n\n"

            "── STEP 5 — OUTPUT ─────────────────────────────────────────────\n"
            "Return ONLY valid JSON. No markdown, no commentary.\n"
            "Use the exact field names from CVSSMetrics:\n"
            "  attack_vector_av, attack_complexity_ac, attack_requirements_at,\n"
            "  privileges_required_pr, user_interaction_ui,\n"
            "  vulnerable_system_confidentiality_vc, vulnerable_system_integrity_vi,\n"
            "  vulnerable_system_availability_va,\n"
            "  subsequent_system_confidentiality_sc, subsequent_system_integrity_si,\n"
            "  subsequent_system_availability_sa"
        ),
        expected_output=(
            "{\n"
            "  \"agentic_ai_tool_misuse\": {\n"
            "    \"attack_vector_av\": \"N|A|L|P\",\n"
            "    \"attack_complexity_ac\": \"L|H\",\n"
            "    \"attack_requirements_at\": \"P|N\",\n"
            "    \"privileges_required_pr\": \"N|L|H\",\n"
            "    \"user_interaction_ui\": \"N|P|A\",\n"
            "    \"vulnerable_system_confidentiality_vc\": \"H|L|N\",\n"
            "    \"vulnerable_system_integrity_vi\": \"H|L|N\",\n"
            "    \"vulnerable_system_availability_va\": \"H|L|N\",\n"
            "    \"subsequent_system_confidentiality_sc\": \"H|L|N\",\n"
            "    \"subsequent_system_integrity_si\": \"H|L|N\",\n"
            "    \"subsequent_system_availability_sa\": \"H|L|N\",\n"
            "  },\n"
            "  \"agent_access_control_violation\":                    { <same structure> },\n"
            "  \"agent_cascading_failures\":                          { <same structure> },\n"
            "  \"agent_orchestration_and_multi_agent_exploitation\":  { <same structure> },\n"
            "  \"agent_identity_impersonation\":                      { <same structure> },\n"
            "  \"agent_memory_and_context_manipulation\":             { <same structure> },\n"
            "  \"insecure_agent_critical_systems_interaction\":       { <same structure> },\n"
            "  \"agent_supply_chain_and_dependency_attacks\":         { <same structure> },\n"
            "  \"agent_untraceability\":                              { <same structure> },\n"
            "  \"agent_goal_and_instruction_manipulation\":           { <same structure> },\n"
            "  \"overall_risk_summary\": \"<concise risk posture summary>\"\n"
            "}"
        ),
        agent=cvss_agent,
        tools=[owasp_tool, cvss_tool],
        output_json=CVSSScoringOutput,
    )

    # ── Crew ─────────────────────────────────────────────────────────────
    inputs = {
        "agent_name":                    agent_name,
        "agent_description":             agent_description,
        "agent_instructions":                        agent_instructions,
        "personally_identifiable_information": personally_identifiable_information,
        "protected_health_information":        protected_health_information,
        "payment_card_industry":               payment_card_industry,
    }

    crew = Crew(
        agents=[cvss_agent],
        tasks=[cvss_task],
        process=Process.sequential,
        verbose=True,
    )

    result      = crew.kickoff(inputs=inputs)
    result_data = result.json_dict
    
    return _build_output(result_data, agent_name, agent_description, baseline_vector, personally_identifiable_information, protected_health_information, payment_card_industry)


# ---------- Quick smoke-test ----------
# if __name__ == "__main__":
#     import json

#     result = score_cvss(
#         agent_name="Business Data Intelligence Analyst Agent",
#         agent_description="Analyzing large volumes of structured and unstructured business data to generate actionable insights, trends, and recommendations that support strategic business decision-making.",
#         agent_instructions="""You are the Business Data Intelligence Analyst — an expert AI agent designed to process, analyze, and interpret large-scale business data across multiple domains including sales, finance, operations, customer behavior, and market trends.
#         Your core responsibilities include:

#         1. **Data Processing & Analysis**
#         - Ingest and process large volumes of structured (CSV, databases, spreadsheets) and unstructured (reports, logs, text) data.
#         - Perform statistical analysis, trend detection, anomaly identification, and pattern recognition.
#         - Cleanse and normalize data to ensure accuracy and consistency before analysis.

#         2. **Business Intelligence & Insights**
#         - Translate raw data into meaningful business insights and KPI summaries.
#         - Identify growth opportunities, bottlenecks, risks, and inefficiencies across business units.
#         - Provide comparative analysis (year-over-year, quarter-over-quarter, segment-based).

#         3. **Decision Support**
#         - Generate data-backed recommendations for strategic and operational business decisions.
#         - Prioritize insights based on business impact, urgency, and feasibility.
#         - Present findings in clear, executive-ready language with supporting data evidence.

#         4. **Reporting & Visualization Guidance**
#         - Summarize findings in structured reports with key metrics, narratives, and next steps.
#         - Suggest appropriate visualization types (charts, dashboards, heatmaps) for data storytelling.

#         5. **Governance & Data Sensitivity**
#         - Handle PII, financial, and sensitive business data with strict confidentiality.
#         - Flag data quality issues, outliers, or gaps that may affect decision reliability.
#         - Always cite data sources and confidence levels in your analysis.

#         Always be precise, objective, and evidence-driven. When data is insufficient, clearly state assumptions and limitations. Prioritize clarity and business relevance in every output.""",
#         personally_identifiable_information="Yes",
#         protected_health_information="No",
#         payment_card_industry="No",
#     )

#     print(json.dumps(result, indent=2))
