"""
Tavro Audit Agent
=================
Tavro ID    : 4edc2ec493223250e3a5fcbe9903d639
File        : 4edc2ec493223250e3a5fcbe9903d639_tavro_audit_agent.py

Description : Performs organization-wide AI agent audits and risk assessments
              based on the AIVSS (AI Vulnerability Scoring System) framework.
              Produces audit-ready HTML reports following the Tavro audit template.

Risk Classification : Unknown
Risk Score          : 4.64
AIVSS Score         : 5.55
EU AI Act Category  : Other

Tools:
  - Get Risk profile details
  - AIA File Upload
  - Get Agent details & related entities
  - Update Audit Report

Data Sources:
  - Tavro Audit Agent

Sensitivity: PII=No | PHI=No | PCI=No
"""

import os
import json
from dataclasses import dataclass, field
from typing import Optional, List, Any, Dict

import anthropic
from dotenv import load_dotenv

load_dotenv()


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class RiskProfile:
    """Risk profile for an AI agent as stored in Tavro."""
    sys_id: str
    agent_sys_id: str
    aivss_score: float
    aivss_classification: str          # e.g. Low / Medium / High / Critical
    eu_ai_act_category: str            # e.g. Prohibited / High-Risk / Limited / Minimal / Other
    risk_classification: str
    has_write_access: bool
    has_operational_access: bool
    pii_involved: bool                 # Not PII data — flag only
    phi_involved: bool                 # Not PHI data — flag only
    pci_involved: bool                 # Not PCI data — flag only
    biometric_use: bool
    component_scores: Dict[str, float] = field(default_factory=dict)
    missing_attributes: List[str] = field(default_factory=list)
    assessment_summary: str = ""
    assessment_status: str = ""        # Active / Cancelled / Failed


@dataclass
class AgentDetail:
    """Core details for a discovered AI agent."""
    sys_id: str
    name: str
    description: str
    platform: str
    source: str
    embedded_ai: bool
    embedded_ai_application: str
    linked_risk_assessment_id: Optional[str]
    is_mission_critical: bool
    is_business_critical: bool
    governance_status: str


@dataclass
class AuditRecord:
    """Top-level audit record linking all agents for a given audit_sys_id."""
    audit_sys_id: str
    organisation: str
    audit_date: str
    total_agents_in_scope: int
    risk_profiles: List[RiskProfile] = field(default_factory=list)
    agents: List[AgentDetail] = field(default_factory=list)
    aivss_guide: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AuditReportPayload:
    """Payload sent to the Update Audit Report tool."""
    audit_sys_id: str
    html_report: str
    generated_at: str
    total_agents: int
    critical_count: int
    high_count: int


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def get_risk_profile_details(audit_sys_id: str) -> Dict[str, Any]:
    """
    Retrieve all risk assessment profiles linked to the given audit_sys_id.

    Returns a dict containing:
      - risk_profiles: list of risk profile records
      - aivss_guide: the official AIVSS scoring guide (thresholds, rules)
      - assessment_summaries: per-agent summary texts
      - cancelled_failed_counts: per-agent count of non-active assessments
    """
    # TODO: Replace with real integration
    return {}


def aia_file_upload(file_content: str, filename: str, mime_type: str = "text/html") -> Dict[str, Any]:
    """
    Upload a file (e.g., the finished HTML audit report) to the AIA document store.

    Args:
        file_content: Raw content of the file to upload.
        filename: Target filename in the document store.
        mime_type: MIME type of the file being uploaded.

    Returns:
        Upload confirmation including document sys_id and URL.
    """
    # TODO: Replace with real integration
    return {}


def get_agent_details_and_related_entities(audit_sys_id: str) -> Dict[str, Any]:
    """
    Retrieve all AI agents linked to the audit, along with related entities such as
    business applications, platforms, and embedded-AI flags.

    Args:
        audit_sys_id: The system ID of the audit record.

    Returns:
        Dict containing agents list, application metadata, and platform breakdown.
    """
    # TODO: Replace with real integration
    return {}


def update_audit_report(audit_sys_id: str, html_report: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persist the final HTML audit report back to the Tavro audit record.

    Args:
        audit_sys_id: The system ID of the audit record to update.
        html_report: Validated, fully-rendered HTML string of the audit report.
        metadata: Summary metadata (agent counts, score stats, generation timestamp).

    Returns:
        Confirmation dict with update status and record URL.
    """
    # TODO: Replace with real integration
    return {}


# ---------------------------------------------------------------------------
# TOOLS list — Claude tool definitions
# ---------------------------------------------------------------------------

TOOLS: List[Dict[str, Any]] = [
    {
        "name": "get_risk_profile_details",
        "description": (
            "Retrieve all risk assessment profiles, AIVSS component scores, assessment summaries, "
            "and the official AIVSS guide for a given audit_sys_id. "
            "Also returns cancelled/failed assessment counts per agent."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The Tavro audit record system ID."
                }
            },
            "required": ["audit_sys_id"]
        }
    },
    {
        "name": "aia_file_upload",
        "description": (
            "Upload the finished HTML audit report or any supporting file to the AIA document store."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_content": {
                    "type": "string",
                    "description": "Raw string content of the file."
                },
                "filename": {
                    "type": "string",
                    "description": "Target filename, e.g. audit_report_<audit_sys_id>.html"
                },
                "mime_type": {
                    "type": "string",
                    "description": "MIME type of the file. Default: text/html",
                    "default": "text/html"
                }
            },
            "required": ["file_content", "filename"]
        }
    },
    {
        "name": "get_agent_details_and_related_entities",
        "description": (
            "Retrieve all AI agents associated with the audit, including platform metadata, "
            "embedded-AI flags, linked risk assessment IDs, and application criticality markers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The Tavro audit record system ID."
                }
            },
            "required": ["audit_sys_id"]
        }
    },
    {
        "name": "update_audit_report",
        "description": (
            "Save the final HTML audit report to the Tavro audit record and mark it as complete."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The system ID of the audit record to update."
                },
                "html_report": {
                    "type": "string",
                    "description": "The complete, validated HTML audit report string."
                },
                "metadata": {
                    "type": "object",
                    "description": "Summary metadata: agent counts, score stats, generation timestamp.",
                    "properties": {
                        "total_agents": {"type": "integer"},
                        "critical_count": {"type": "integer"},
                        "high_count": {"type": "integer"},
                        "generated_at": {"type": "string"}
                    }
                }
            },
            "required": ["audit_sys_id", "html_report", "metadata"]
        }
    }
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Route an incoming tool-use request from Claude to the appropriate stub function.

    Args:
        name:   The tool name as declared in TOOLS.
        inputs: The input arguments extracted from the Claude tool_use block.

    Returns:
        JSON-serialisable result from the called stub, or an error dict.
    """
    dispatch_map = {
        "get_risk_profile_details": lambda i: get_risk_profile_details(
            audit_sys_id=i["audit_sys_id"]
        ),
        "aia_file_upload": lambda i: aia_file_upload(
            file_content=i["file_content"],
            filename=i["filename"],
            mime_type=i.get("mime_type", "text/html")
        ),
        "get_agent_details_and_related_entities": lambda i: get_agent_details_and_related_entities(
            audit_sys_id=i["audit_sys_id"]
        ),
        "update_audit_report": lambda i: update_audit_report(
            audit_sys_id=i["audit_sys_id"],
            html_report=i["html_report"],
            metadata=i.get("metadata", {})
        ),
    }

    handler = dispatch_map.get(name)
    if handler is None:
        return {"error": f"Unknown tool: {name}"}

    try:
        result = handler(inputs)
        return result if result is not None else {"status": "ok", "data": None}
    except Exception as exc:  # pragma: no cover
        return {"error": str(exc), "tool": name, "inputs": inputs}


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are the **Tavro Audit Agent** — an authoritative AI governance auditor operating within
the Tavro platform. Your sole purpose is to produce a rigorous, audit-ready HTML report for
a given `audit_sys_id`, following the mandatory Tavro audit template and the AIVSS framework.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE WARNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This agent's governance status is **Not Set**. It has not received formal approval.
Operate with heightened caution:
  • Do not expose internal system identifiers beyond those needed for the report.
  • Do not speculate or extrapolate beyond retrieved records.
  • Every claim must be traceable to a retrieved data record or the official AIVSS guide.
  • Flag this governance gap in the audit trail metadata.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY & ROLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are an expert in AI governance, risk management, and regulatory compliance (EU AI Act,
AIVSS framework). You conduct organisation-wide audits of AI agents, validate risk scores,
and synthesise findings into executive-grade reports for senior stakeholders and compliance teams.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA SENSITIVITY GUARDRAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• PII: No — do not treat any retrieved field as personally identifiable.
• PHI: No — no protected health information in scope.
• PCI: No — no payment card data in scope.
Even so, apply the principle of minimum necessary disclosure. Do not reproduce raw data
dumps in the report; only present processed, aggregated, or validated findings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RISK-AWARE GUARDRAILS  (Risk Score 4.64 | AIVSS 5.55 | EU AI Act: Other)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• This agent itself carries a Medium risk profile. Apply conservative judgment.
• Do not make irreversible write operations without confirming the audit report is complete.
• AIVSS score thresholds (apply guide values if they differ):
    Low      :  0.0 – 3.9
    Medium   :  4.0 – 6.9
    High     :  7.0 – 8.9
    Critical :  9.0 – 10.0
• EU AI Act: flag agents in Prohibited or High-Risk categories by name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPERATIONAL INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OBJECTIVE
Produce an audit-ready HTML report for a given audit_sys_id by retrieving linked risk
assessments, agents, and summaries, validating every AIVSS score and classification against
the official AIVSS guide, and synthesising validated findings into the mandated Tavro template.

INPUT
  audit_sys_id — a single string value provided by the caller.

BUSINESS RULES
• Use agent names wherever meaningful — sentences should read:
  "<AgentName> is classified as …" rather than "1 agent has …".
• Vary tone and sentence structure throughout the report — avoid monotony.
• The report must not look like a wall of text; use structure, emphasis, and layout.

DATA RETRIEVAL & VALIDATION
• Use only tool-based retrievals. Use `get_risk_profile_details` to obtain the official
  AIVSS reference guide as well as all risk data.
• Missing numeric fields → use a sensible, professionally worded placeholder ("Data Not Available").
• Do not infer or extrapolate beyond retrieved records.

MANDATORY PROCESSING STEPS
1. Retrieve all risk assessments for audit_sys_id, all linked agents, all assessment summaries.
2. Load the official AIVSS guide; extract: score thresholds, classification rules, required
   attributes, and validation logic.
3. For each agent: recompute AIVSS where component attributes are present; compare to stored
   score; compare stored classification to guide-derived classification; flag mismatches and
   missing attributes.
4. Use agent names in every relevant sentence — never anonymous "Agent #N".
5. Produce detailed entries ONLY for exceptions (misclassifications, outliers, missing critical
   attributes).
6. If an agent's summary field is empty, note the count of Cancelled/Failed assessments and
   mention that in audit scope. Strictly exclude that agent's data from all other analysis.

REPORT TEMPLATE — SECTION-BY-SECTION

── Executive Audit Report (h2 heading) ──

── 1. Executive Summary (h3) ──
  Audit Scope paragraph:
    "Assessment of {N} agents discovered via Tavro across {platforms} Platforms.
     The objective of the assessment is to identify potential gaps in agent governance,
     critical risk exposure and the business impact."

  Visibility Gap sub-point:
    Embedded AI Yes = X
    AI Yes + no associated agent = Y  → Mission Critical = Y/X × 100 %
    AI Yes + associated agent present = Z → Business Critical = Z/X × 100 %

  Critical Exposure:
    Count agents with AIVSS ≥ 7 and AIVSS ≥ 9; quantify how many of those have
    write/operational access.

  Regulatory Posture:
    Enumerate agents (by name) triggering Prohibited Practices or High-Risk under EU AI Act.

  Strategic Recommendations:
    3–5 prioritised, factual recommendations tied strictly to documented findings.

── 2. Detailed Observations (h3) ──
  Opening paragraph about AIVSS distribution (use exact total count).

  Agent Risk Distribution Summary:
    Narrative description of score clustering.

  Key Observations (three explicit points):
    • Risk Concentration — agents by name in High (≥7) and Critical (≥9) bins.
      An agent already in Critical must NOT also appear in High.
    • Data Integrity — validation results: complete-attribute count, recomputed-vs-stored matches.
    • Score Gap — min, max, notable contiguous range gaps (only where meaningful).

  Detected Anomalies:
    If none → "No anomalies detected based on available assessment data." (no table).
    If any → HTML table with columns: Anomaly Type | Description | Observations.

  Next Best Action:
    3–5 evidence-backed next steps tied to specific findings.
    Do NOT reference missing data — this is an action section.

── 3. Risk Assessment Details by Agent (h3) ──
  HTML table (thead/tbody). Exact columns in order:
    S.No | Agent Name | Regulatory Risk Classification | AIVSS Score
  Sequential S.No. All agents included. Use "Data Not Available" for missing values.
  No extra columns or commentary below the table.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRESENTATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Output must be valid, rich HTML.
• Sub-headings and key labels: <strong> or <b>.
• Highlight important values (agent names, scores, platform names): <strong> or <span> with
  inline style where appropriate.
• Every flagged anomaly must cite numeric evidence (recomputed score, missing attribute name).
• Save final output to a variable and invoke `update_audit_report` with that payload.

TONE & CONSTRAINTS
• Professional, factual, evidence-based. No speculation.
• Avoid LLM/robotic phrasing. No "It is worth noting that…", "Certainly!", etc.
• Do not state the obvious or over-explain. Be concise but complete.
• Every statement must be traceable to a retrieved record or the AIVSS guide.
"""


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Execute the Tavro Audit Agent agentic loop.

    Sends the user message to Claude, handles all tool-use turns, and returns
    the final text response (the completed audit report or a status message).

    Args:
        user_message: The triggering message, typically containing the audit_sys_id.

    Returns:
        The final text output from Claude after all tool interactions complete.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages: List[Dict[str, Any]] = [
        {"role": "user", "content": user_message}
    ]

    print(f"[Tavro Audit Agent] Starting audit run …")
    print(f"[Tavro Audit Agent] User message: {user_message[:120]}{'…' if len(user_message) > 120 else ''}")

    iteration = 0
    max_iterations = 20  # Guard against runaway loops

    while iteration < max_iterations:
        iteration += 1
        print(f"[Tavro Audit Agent] Calling Claude (iteration {iteration}) …")

        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages
        )

        print(f"[Tavro Audit Agent] Stop reason: {response.stop_reason}")

        # Collect all tool-use blocks in this response turn
        tool_use_blocks = [block for block in response.content if block.type == "tool_use"]
        text_blocks = [block for block in response.content if block.type == "text"]

        if response.stop_reason == "end_turn" or not tool_use_blocks:
            # No more tool calls — extract and return final text
            final_text = "\n".join(block.text for block in text_blocks if hasattr(block, "text"))
            print(f"[Tavro Audit Agent] Completed. Output length: {len(final_text)} chars.")
            return final_text

        # Append assistant turn to conversation history
        messages.append({"role": "assistant", "content": response.content})

        # Process every tool call in this turn
        tool_results = []
        for tool_block in tool_use_blocks:
            tool_name = tool_block.name
            tool_inputs = tool_block.input
            tool_use_id = tool_block.id

            print(f"[Tavro Audit Agent] Tool called: {tool_name} | inputs: {json.dumps(tool_inputs, default=str)[:200]}")

            raw_result = handle_tool_call(tool_name, tool_inputs)
            result_str = json.dumps(raw_result, default=str)

            print(f"[Tavro Audit Agent] Tool result ({tool_name}): {result_str[:200]}{'…' if len(result_str) > 200 else ''}")

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": result_str
            })

        # Append all tool results as a single user turn
        messages.append({"role": "user", "content": tool_results})

    print(f"[Tavro Audit Agent] WARNING: Max iterations ({max_iterations}) reached.")
    return "Audit run exceeded maximum iterations. Please review tool integrations and retry."


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Trigger the Tavro Audit Agent for a specific audit record.

    In production this audit_sys_id would be passed via a Tavro workflow trigger,
    a REST callback, or a scheduled job. Here we demonstrate the call pattern.
    """
    # The audit_sys_id to process — in production, source this from environment
    # variable, CLI argument, or incoming webhook payload.
    audit_sys_id = os.environ.get("TAVRO_AUDIT_SYS_ID", "4edc2ec493223250e3a5fcbe9903d639")

    user_message = (
        f"Please conduct a full AIVSS-based audit for audit_sys_id: {audit_sys_id}.\n\n"
        f"Steps to follow:\n"
        f"1. Call `get_agent_details_and_related_entities` with audit_sys_id='{audit_sys_id}' "
        f"   to retrieve all agents, their platforms, embedded-AI flags, and application metadata.\n"
        f"2. Call `get_risk_profile_details` with audit_sys_id='{audit_sys_id}' to retrieve "
        f"   all risk assessments, AIVSS component scores, assessment summaries, and the "
        f"   official AIVSS reference guide.\n"
        f"3. Validate every AIVSS score and classification against the official guide. "
        f"   Recompute scores where component attributes are available. Flag mismatches.\n"
        f"4. Exclude any agent whose summary field is empty; record their Cancelled/Failed "
        f"   assessment count and mention it in the audit scope.\n"
        f"5. Compose the full HTML audit report following the Tavro mandatory template "
        f"   (Executive Audit Report → Executive Summary → Detailed Observations → "
        f"   Risk Assessment Details by Agent).\n"
        f"6. Call `update_audit_report` with audit_sys_id='{audit_sys_id}', the complete "
        f"   HTML report, and the summary metadata dict.\n"
        f"7. Optionally call `aia_file_upload` to archive the HTML report in the document store.\n\n"
        f"Return the finished HTML report as your final response."
    )

    result = run_agent(user_message)

    print("\n" + "=" * 80)
    print("TAVRO AUDIT AGENT — FINAL OUTPUT")
    print("=" * 80)
    print(result)
    print("=" * 80)


# ---------------------------------------------------------------------------
# Approval Workflow & Azure Publishing
# ---------------------------------------------------------------------------

def approval_workflow() -> None:
    """
    Post-execution governance workflow for the Tavro Audit Agent.

    Checks whether the agent's governance status has been formally approved.
    If not, raises an alert and blocks downstream publishing steps.

    In a production deployment this would integrate with the Tavro governance
    API to update the approval record and notify relevant stakeholders.
    """
    governance_status = os.environ.get("TAVRO_GOVERNANCE_STATUS", "Not set")
    agent_name = "Tavro Audit Agent"
    tavro_id = "4edc2ec493223250e3a5fcbe9903d639"

    print(f"\n[Approval Workflow] Checking governance status for '{agent_name}' ({tavro_id}) …")

    if governance_status.lower() not in ("approved",):
        print(
            f"[Approval Workflow] ⚠️  GOVERNANCE STATUS: '{governance_status}' — "
            f"formal approval has not been granted.\n"
            f"  Action required: A designated AI governance officer must review the audit "
            f"  output and approve this agent in the Tavro platform before it can be "
            f"  promoted to production or scheduled for automated runs.\n"
            f"  Publishing to Azure is BLOCKED until approval is confirmed."
        )
        # In production: send notification to governance team, create a Tavro task record,
        # and halt the CI/CD pipeline.
        return

    print(f"[Approval Workflow] ✅ Agent '{agent_name}' is Approved. Proceeding to publish …")
    publish_to_azure()


def publish_to_azure() -> None:
    """
    Publish the approved Tavro Audit Agent artefacts to the Azure deployment target.

    Responsibilities (production implementation):
      - Package the agent source file and dependencies.
      - Push the container image or function app package to Azure Container Registry
        or Azure Functions.
      - Update the Tavro platform registry with the deployed endpoint URL.
      - Trigger a post-deployment smoke test to verify tool connectivity.

    Current state: stub — replace with real Azure SDK / CLI calls.
    """
    print("[Azure Publish] Initiating deployment to Azure …")

    # TODO: Replace with real Azure deployment logic, e.g.:
    #   from azure.identity import DefaultAzureCredential
    #   from azure.mgmt.containerinstance import ContainerInstanceManagementClient
    #   credential = DefaultAzureCredential()
    #   … deploy container with agent image …

    deployment_target = os.environ.get("AZURE_DEPLOYMENT_TARGET", "azure-functions-tavro-prod")
    print(f"[Azure Publish] Target environment : {deployment_target}")
    print(f"[Azure Publish] Agent file          : 4edc2ec493223250e3a5fcbe9903d639_tavro_audit_agent.py")
    print(f"[Azure Publish] Status              : Deployment stub — integration pending.")
    print(f"[Azure Publish] Next step           : Configure AZURE_DEPLOYMENT_TARGET and Azure credentials.")


def fix_issues() -> None:
    """
    Remediation helper invoked when the audit run surfaces critical issues
    or when the approval workflow detects a governance gap.

    Typical remediation actions:
      - Re-trigger data retrieval if tool stubs returned empty results.
      - Patch missing AIVSS component attributes in source records.
      - Escalate Prohibited / High-Risk EU AI Act classifications to the risk team.
      - Re-run the agentic loop after fixes are applied.
    """
    print("[Fix Issues] Scanning for known remediation paths …")

    remediation_steps = [
        "1. Verify ANTHROPIC_API_KEY is set and valid.",
        "2. Confirm tool integrations (get_risk_profile_details, get_agent_details_and_related_entities) "
        "   are connected to live Tavro data endpoints.",
        "3. Ensure TAVRO_AUDIT_SYS_ID environment variable is set to a valid audit record ID.",
        "4. Check that the AIVSS guide is retrievable via get_risk_profile_details — "
        "   if not, provide a static fallback guide path.",
        "5. For agents with empty summaries, confirm whether their assessments are genuinely "
        "   Cancelled/Failed or if a data pipeline issue exists.",
        "6. If EU AI Act Prohibited agents are identified, escalate to the AI Ethics Board "
        "   immediately — do not schedule further automated runs until resolved.",
        "7. Set TAVRO_GOVERNANCE_STATUS=Approved in the environment once formal sign-off is obtained.",
    ]

    for step in remediation_steps:
        print(f"[Fix Issues]   {step}")

    print("[Fix Issues] Remediation checklist printed. Address items above and re-run main().")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()