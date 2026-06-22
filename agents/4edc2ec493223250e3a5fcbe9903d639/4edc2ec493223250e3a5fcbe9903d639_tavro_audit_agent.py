"""
Tavro Audit Agent
=================
Tavro ID      : 4edc2ec493223250e3a5fcbe9903d639
File          : 4edc2ec493223250e3a5fcbe9903d639_tavro_audit_agent.py

Role          : Organization audit agent for all agents and risk assessment details
                based on the AIVSS framework.
Description   : Produces audit-ready HTML reports by retrieving linked risk
                assessments, agents, and summaries, validating every AIVSS score
                and classification against the official AIVSS guide, and
                synthesizing validated findings into the mandated Tavro template.

Risk          : Classification=Unknown | Score=4.64
                EU AI Act=Other       | AIVSS=5.55

Tools         : Get Risk profile details
                AIA File Upload
                Get Agent details & related entities
                Update Audit Report

Data Sources  : Tavro Audit Agent
PII/PHI/PCI   : No / No / No
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
class TavroAuditAgentRecord:
    """Represents a record from the 'Tavro Audit Agent' data source."""
    sys_id: str
    agent_name: str
    agent_description: Optional[str] = None
    agent_source: Optional[str] = None          # platform / source system
    agent_status: Optional[str] = None          # active, inactive, etc.

    # Risk & governance
    aivss_score: Optional[float] = None
    aivss_classification: Optional[str] = None  # Low / Medium / High / Critical
    risk_classification: Optional[str] = None
    eu_ai_act_category: Optional[str] = None

    # Assessment linkage
    assessment_sys_id: Optional[str] = None
    assessment_summary: Optional[str] = None
    assessment_status: Optional[str] = None     # Active / Cancelled / Failed

    # Capability flags (used for EU AI Act mapping)
    has_write_access: bool = False
    has_operational_access: bool = False
    uses_biometrics: bool = False
    embedded_ai: Optional[str] = None           # "Yes" / "No"
    associated_agent: Optional[str] = None

    # Access / sensitivity — no PII, PHI, or PCI per configuration
    pii_data: bool = False   # PII: No
    phi_data: bool = False   # PHI: No
    pci_data: bool = False   # PCI: No

    # AIVSS component attributes (for recomputation)
    aivss_components: Dict[str, Any] = field(default_factory=dict)

    # Regulatory flags
    prohibited_practice: bool = False
    high_risk_eu: bool = False


@dataclass
class RiskProfileRecord:
    """Represents a risk profile retrieved from the risk-profile tool."""
    sys_id: str
    agent_sys_id: str
    profile_name: Optional[str] = None
    overall_score: Optional[float] = None
    classification: Optional[str] = None
    component_scores: Dict[str, float] = field(default_factory=dict)
    last_assessed: Optional[str] = None
    assessor: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class AgentDetailRecord:
    """Represents agent details and related entities."""
    sys_id: str
    name: str
    description: Optional[str] = None
    owner: Optional[str] = None
    department: Optional[str] = None
    source_platform: Optional[str] = None
    linked_assessment_ids: List[str] = field(default_factory=list)
    linked_risk_profile_ids: List[str] = field(default_factory=list)
    governance_status: Optional[str] = None
    created_on: Optional[str] = None
    updated_on: Optional[str] = None


@dataclass
class AuditReportRecord:
    """Represents an audit report payload for the Update Audit Report tool."""
    audit_sys_id: str
    report_html: str
    generated_at: Optional[str] = None
    generated_by: str = "Tavro Audit Agent"
    status: str = "Draft"
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def get_risk_profile_details(audit_sys_id: str) -> Dict[str, Any]:
    """
    Retrieve all risk-profile records linked to the given audit system ID.

    Args:
        audit_sys_id: The sys_id of the audit record whose risk profiles
                      are to be fetched.

    Returns:
        A dictionary containing a list of risk profile objects with their
        AIVSS component scores, classifications, and metadata.
    """
    # TODO: Replace with real integration
    return {}


def aia_file_upload(file_content: str, file_name: str, content_type: str = "text/html") -> Dict[str, Any]:
    """
    Upload a file (e.g., an HTML audit report) to the AIA document store.

    Args:
        file_content:  Raw string content of the file to upload.
        file_name:     Desired file name in the document store.
        content_type:  MIME type of the content (default 'text/html').

    Returns:
        A dictionary containing the upload result, including the document
        sys_id and URL for retrieval.
    """
    # TODO: Replace with real integration
    return {}


def get_agent_details_and_related_entities(audit_sys_id: str) -> Dict[str, Any]:
    """
    Retrieve all agents linked to the given audit system ID together with
    their related entities (assessments, risk profiles, summaries, AIVSS
    component attributes, EU AI Act mapping fields).

    Args:
        audit_sys_id: The sys_id of the audit record.

    Returns:
        A dictionary containing agents, assessments, summaries, and the
        OWASP AIVSS reference guide required for validation.
    """
    # TODO: Replace with real integration
    return {}


def update_audit_report(audit_sys_id: str, report_html: str, status: str = "Draft") -> Dict[str, Any]:
    """
    Persist the generated HTML audit report back to the Tavro platform
    against the specified audit record.

    Args:
        audit_sys_id: The sys_id of the audit record to update.
        report_html:  The fully rendered HTML audit report string.
        status:       Lifecycle status for the report (default 'Draft').

    Returns:
        A dictionary with the update confirmation, including the updated
        record sys_id and timestamp.
    """
    # TODO: Replace with real integration
    return {}


# ---------------------------------------------------------------------------
# Claude Tool Definitions
# ---------------------------------------------------------------------------

TOOLS: List[Dict[str, Any]] = [
    {
        "name": "get_risk_profile_details",
        "description": (
            "Retrieves all risk-profile records linked to a given audit_sys_id, "
            "including AIVSS component scores, overall score, classification, "
            "and assessment metadata. Use this to gather the raw scoring data "
            "needed for AIVSS validation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The sys_id of the audit record whose risk profiles are to be fetched."
                }
            },
            "required": ["audit_sys_id"]
        }
    },
    {
        "name": "aia_file_upload",
        "description": (
            "Uploads a file to the AIA document store. Primarily used to store "
            "the generated HTML audit report as an attached document. "
            "Returns the document sys_id and retrieval URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "file_content": {
                    "type": "string",
                    "description": "Raw string content of the file to upload."
                },
                "file_name": {
                    "type": "string",
                    "description": "Desired file name in the document store."
                },
                "content_type": {
                    "type": "string",
                    "description": "MIME type of the content. Defaults to 'text/html'.",
                    "default": "text/html"
                }
            },
            "required": ["file_content", "file_name"]
        }
    },
    {
        "name": "get_agent_details_and_related_entities",
        "description": (
            "Retrieves all agents linked to the given audit_sys_id along with "
            "their related entities: assessments, risk profiles, assessment "
            "summaries, AIVSS component attributes, embedded-AI flags, and the "
            "OWASP AIVSS reference guide. This is the primary data-gathering "
            "tool that must be called before any analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The sys_id of the audit record."
                }
            },
            "required": ["audit_sys_id"]
        }
    },
    {
        "name": "update_audit_report",
        "description": (
            "Persists the completed HTML audit report back to the Tavro platform "
            "against the specified audit record. Must be the final tool call after "
            "the report HTML has been fully generated and stored in ${audit_result}."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "audit_sys_id": {
                    "type": "string",
                    "description": "The sys_id of the audit record to update."
                },
                "report_html": {
                    "type": "string",
                    "description": "The fully rendered HTML audit report string."
                },
                "status": {
                    "type": "string",
                    "description": "Lifecycle status for the report.",
                    "enum": ["Draft", "Final", "Under Review"],
                    "default": "Draft"
                }
            },
            "required": ["audit_sys_id", "report_html"]
        }
    }
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Route an incoming tool call from the Claude model to the appropriate
    stub function and return the serialised result.

    Args:
        name:   Name of the tool as defined in TOOLS.
        inputs: Dictionary of input parameters provided by the model.

    Returns:
        JSON-serialisable result from the corresponding tool function.
    """
    if name == "get_risk_profile_details":
        return get_risk_profile_details(
            audit_sys_id=inputs["audit_sys_id"]
        )

    elif name == "aia_file_upload":
        return aia_file_upload(
            file_content=inputs["file_content"],
            file_name=inputs["file_name"],
            content_type=inputs.get("content_type", "text/html")
        )

    elif name == "get_agent_details_and_related_entities":
        return get_agent_details_and_related_entities(
            audit_sys_id=inputs["audit_sys_id"]
        )

    elif name == "update_audit_report":
        return update_audit_report(
            audit_sys_id=inputs["audit_sys_id"],
            report_html=inputs["report_html"],
            status=inputs.get("status", "Draft")
        )

    else:
        return {"error": f"Unknown tool: {name}"}


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are the **Tavro Audit Agent** (Tavro ID: 4edc2ec493223250e3a5fcbe9903d639), operating within the Tavro AI Governance Platform.

⚠️  GOVERNANCE WARNING: The governance status for this agent is currently **Not Set**. All outputs must be treated as preliminary/draft until formal governance approval is obtained. Do not publish or act on findings without appropriate human review.

---

## Identity & Role

You are an AI governance auditor specialised in AIVSS-framework-based risk assessments. Your sole purpose is to produce a factual, evidence-backed, audit-ready HTML report for a given `audit_sys_id`. You retrieve data, validate it against the official AIVSS guide, and synthesise findings into the mandated Tavro template. You do not speculate, extrapolate, or invent data.

---

## Business Context

This agent conducts organisation-wide audits of all discovered AI agents and their risk assessment details. The audit validates AIVSS scores and classifications, maps agents to EU AI Act categories, identifies governance gaps, and surfaces critical risk exposures for leadership review.

---

## Operational Instructions

### Objective
Produce an audit-ready HTML report for a given `audit_sys_id` by retrieving linked risk assessments, agents, and summaries, validating every AIVSS score and classification against the official AIVSS guide, and synthesising validated findings into the mandated Tavro template.

### Input
- `audit_sys_id` (single value)

### Business Rules
- Take agent names wherever necessary, majorly in where an agent is differentiating in any point.
- Do not be monotonic in tone and writing — be a little dynamic in those areas.
- Based on data, produce a report that doesn't look like just a bunch of text.

### Data Retrieval & Validation Precepts
- Use only Script Tool retrievals and use the 'Get AIVSS guide' tool to extract the official AIVSS reference guide.
- If a required field or attribute is missing, return generic statements; if numbers or quantifiable statements are involved, use sensible statements that reports generally have.
- Do not infer or extrapolate beyond retrieved records. All claims must be traceable to retrieved data or guide rules.

### Mandatory Processing Steps (condensed)
1. **Retrieve**: all risk assessments for `audit_sys_id`, all agents linked to those assessments, all assessment summaries, and OWASP AIVSS summary. (No intermediate output.)
2. **Load** the official AIVSS guide and extract: score thresholds, classification rules, required attributes, and the exact validation logic.
3. **For each agent**: recompute AIVSS where component attributes exist; compare recomputed score to stored score; compare stored classification to classification derived from guide thresholds; flag mismatches and missing attributes.
4. Mention the **name of agent** wherever needed instead of "1 agent has so and so". Make sentences like: `<agent_name> is classified as ...`. If more than one agent, name all of them. Have proper detailed sentences that are understandable.
5. Only produce detailed entries for **exceptions** (misclassifications, outliers, missing critical attributes).
6. If the summary field is empty for any agent, make note of the count of all Cancelled/Failed assessments and mention that in audit scope. **Strictly do not use that agent's data anywhere.**

### Template — What to Include in Each Section

#### Executive Audit Report (h2) → top-level title.

#### 1. Executive Summary (h3)
- **Audit scope**: Assessment of {total count of assessment} agents discovered via Tavro across {list of agent sources/platforms} Platforms. The objective is to identify potential gaps in agent governance, critical risk exposure and the business impact.
  - **Visibility Gap**: [x] out of total business applications indicate that they have embedded AI Yes but no associated agents have been identified or discovered in the system. Calculate [x]% of these applications as mission critical and remaining [y]% as business critical from Embedded AI as Yes application count (not total application count).
    - In simple words:
      - Embedded AI Yes = x
      - AI Yes and associated agent is empty = y
      - AI Yes and associated agent is not empty = z
      - mission critical = y/x*100
      - business critical = z/x*100
  - **Critical Exposure**: count agents with AIVSS >= 7 and those with AIVSS >= 9; quantify how many of those have write/operational access.
  - **Regulatory Posture**: enumerate numbers of agents with their names triggering Prohibited Practices or High-Risk categories per EU AI Act mapping.
- **Strategic Recommendation**: provide 3–5 prioritised, factual recommendations strictly tied to documented findings. No generic suggestions.

#### 2. Detailed Observations (h3)
- **Agent Risk Distribution Summary**: The distribution of AIVSS scores and corresponding risk classifications is a critical metric for understanding the organisation's exposure to AI-related vulnerabilities. The current assessment of the {total number of assessments} agents reveals a distinct clustering of risk at the upper end of the AIVSS scale (High Risk), highlighting a concentration of significant potential exposure.
- **Key Observations**: three explicit points:
  1. **Risk Concentration**: report number and percent of agents (with names) in High (>=7) and Critical (>=9) bins. Agents already in Critical bin must NOT be mentioned in the High bin.
  2. **Data Integrity**: state validation results — which agents and how many had complete attributes, how many recomputed scores matched stored scores. Use exact counts.
  3. **Score Gap**: report min, max, and any notable gaps in contiguous score ranges. Only mention when meaningful.
- **Detected Anomalies**:
  - List only exceptions. If no anomalies found regarding assessment data, **strictly state**: "No anomalies detected based on available assessment data." (without table)
  - For each anomaly include agent id, anomaly type, short factual description. Use tabular format with headers: Anomaly Type | Description | Observations.
- **Next Best Action**: 3–5 evidence-backed next steps, each tied to a specific finding. Do not mention anything about missing or unavailable data — this is an action section.

#### 3. Risk Assessment Details by Agent (h3)
- Provide an HTML table (thead/tbody) with exact columns in order: **S.No, Agent Name, Regulatory Risk Classification, AIVSS Score** (score only). S.No sequential. Include all agents. For any missing value use "Data Not Available" or similar. No extra columns or commentary.

### Data Interpretation & Validation Rules
- **Score bounds**: AIVSS range 0–10. Use guide thresholds: High risk >= 7.0, Critical risk >= 9.0. Always take higher values — if all agents are Critical, no need to also mention High risk for them.
- **Outlier & clustering detection**: Compute IQR; mark agents as outliers if score < Q1 - 1.5×IQR or > Q3 + 1.5×IQR; report clustering if a plurality of agents fall above the High threshold (document exact percent). Avoid interpretive language beyond these metrics.
- **Regulatory mapping**: Map attributes (PII/PHI/PCI, biometric use, write access) to EU AI Act categories per guide; point out if mapping inputs are missing.

### Presentation & Audit-Readiness Rules
- Output must be **valid Rich HTML** using specified tags.
- Highlight key metrics visually (bold or emphasised HTML) but preserve exact narrative wording from the template where present.
- Make subpoints bold and highlighted. For important values like agent names, platform names, scores — emphasise them.
- Justify every flagged anomaly by citing the numeric evidence (e.g., recomputed score, missing attribute name).
- Save final output to `${audit_result}` and invoke **Update Audit Report** with that payload.

---

## Data Sensitivity Guardrails

This agent handles **no PII, no PHI, and no PCI data**. Despite this:
- Do not log, echo, or transmit any data fields that appear to contain personal identifiers, health information, or payment details if encountered unexpectedly in retrieved records.
- Treat all retrieved organisational data as internal-confidential.
- Do not include raw API responses in the final report HTML.

---

## Risk-Aware Guardrails

- **Risk Score**: 4.64 (Unknown classification) | **AIVSS**: 5.55 | **EU AI Act**: Other
- Given the Unknown risk classification, apply conservative judgement: when in doubt, flag for human review rather than making a determination.
- Do not make autonomous decisions about agent governance status or risk classifications beyond what the AIVSS guide explicitly supports.
- All findings in the report are advisory. Governance decisions rest with authorised human reviewers.
- This agent's own governance status is **Not Set** — outputs are inherently draft until a human approver signs off.

---

## Tone and Constraints
- Professional, factual, evidence-based. No speculation or extrapolation.
- Every statement must be tied to a retrieved record or the AIVSS guide.
- No LLM or robotic tone. No overly obvious statements. No overexplaining.
- Be dynamic — vary sentence structure and phrasing across sections.
- The report should look visually structured, not a wall of text.
"""


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Execute the Tavro Audit Agent agentic loop.

    Sends the user message to Claude, processes any tool calls, and continues
    until a final text response is returned.

    Args:
        user_message: The natural-language instruction triggering the audit,
                      typically containing the audit_sys_id.

    Returns:
        The final text response from the model (may include a confirmation
        that the audit report has been saved).
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    messages: List[Dict[str, Any]] = [
        {"role": "user", "content": user_message}
    ]

    print(f"[Tavro Audit Agent] Starting audit run...")
    print(f"[Tavro Audit Agent] User message: {user_message[:120]}{'...' if len(user_message) > 120 else ''}")

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages
        )

        print(f"[Tavro Audit Agent] Model stop reason: {response.stop_reason}")

        # Append the assistant turn
        messages.append({"role": "assistant", "content": response.content})

        # If the model is done, extract and return the final text
        if response.stop_reason == "end_turn":
            final_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text
            print("[Tavro Audit Agent] Audit run complete.")
            return final_text

        # Handle tool use
        if response.stop_reason == "tool_use":
            tool_results = []

            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_inputs = block.input
                    tool_use_id = block.id

                    print(f"[Tavro Audit Agent] Tool call → {tool_name}({json.dumps(tool_inputs, default=str)[:200]})")

                    try:
                        result = handle_tool_call(tool_name, tool_inputs)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": json.dumps(result, default=str)
                        })
                        print(f"[Tavro Audit Agent] Tool result for {tool_name}: OK")
                    except Exception as exc:
                        error_payload = {"error": str(exc), "tool": tool_name}
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": json.dumps(error_payload),
                            "is_error": True
                        })
                        print(f"[Tavro Audit Agent] Tool error for {tool_name}: {exc}")

            # Feed tool results back to the model
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop reason — surface the last response text and exit
            fallback_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    fallback_text += block.text
            print(f"[Tavro Audit Agent] Unexpected stop reason: {response.stop_reason}")
            return fallback_text or f"[Audit agent stopped unexpectedly: {response.stop_reason}]"


# ---------------------------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Realistic invocation of the Tavro Audit Agent.

    Triggers a full organisational audit for the audit record identified by
    the TAVRO_AUDIT_SYS_ID environment variable (falls back to a default
    test sys_id if not set). Prints the final report confirmation to stdout.
    """
    audit_sys_id = os.getenv("TAVRO_AUDIT_SYS_ID", "4edc2ec493223250e3a5fcbe9903d639")

    user_message = (
        f"Please run a full organisational audit for audit_sys_id = '{audit_sys_id}'. "
        "Retrieve all linked agents and their risk assessments, validate every AIVSS "
        "score and classification against the official AIVSS guide, and produce the "
        "mandated Tavro audit report in valid HTML. Once the report is generated, "
        "upload it via AIA File Upload and then persist it using Update Audit Report. "
        "Ensure all three sections — Executive Summary, Detailed Observations, and "
        "Risk Assessment Details by Agent — are complete and accurate."
    )

    result = run_agent(user_message)
    print("\n" + "=" * 80)
    print("TAVRO AUDIT AGENT — FINAL OUTPUT")
    print("=" * 80)
    print(result)
    print("=" * 80 + "\n")


# ---------------------------------------------------------------------------
# Approval Workflow & Azure Publishing
# ---------------------------------------------------------------------------

def approval_workflow() -> None:
    """
    Stub for the Tavro governance approval workflow.

    In production this would:
    1. Submit the generated draft audit report for human review.
    2. Notify the designated approver(s) via the configured notification channel.
    3. Poll or await a webhook for the approval decision.
    4. Update the report status to 'Final' upon approval or 'Rejected' on refusal.
    5. Log the approval chain for audit-trail purposes.

    NOTE: The governance status of this agent is currently **Not Set**.
          This workflow must be completed before any report is treated as Final.
    """
    audit_sys_id = os.getenv("TAVRO_AUDIT_SYS_ID", "4edc2ec493223250e3a5fcbe9903d639")
    approver_email = os.getenv("TAVRO_APPROVER_EMAIL", "governance-team@organisation.internal")

    print(f"[Approval Workflow] Submitting audit report for '{audit_sys_id}' to {approver_email} for review.")
    print("[Approval Workflow] Status: Pending Human Approval")
    print("[Approval Workflow] ⚠️  Governance status is Not Set — report remains Draft until approved.")
    # TODO: Replace with real approval integration (e.g., ServiceNow approval task, email trigger, etc.)


def publish_to_azure() -> None:
    """
    Stub for publishing the approved audit report to Azure storage / platform.

    In production this would:
    1. Retrieve the approved HTML report from the Tavro platform.
    2. Authenticate to Azure Blob Storage (or Azure DevOps / Power BI, etc.)
       using credentials from environment variables.
    3. Upload the report to the configured container / workspace.
    4. Return and log the public or internal URL of the published artefact.
    5. Update the audit record with the Azure artefact reference.
    """
    audit_sys_id = os.getenv("TAVRO_AUDIT_SYS_ID", "4edc2ec493223250e3a5fcbe9903d639")
    azure_container = os.getenv("AZURE_AUDIT_CONTAINER", "tavro-audit-reports")

    print(f"[Azure Publish] Publishing approved audit report for '{audit_sys_id}' to container '{azure_container}'.")
    print("[Azure Publish] Status: Pending — approval must be confirmed before publishing.")
    # TODO: Replace with real Azure SDK integration (azure-storage-blob, etc.)


def fix_issues() -> None:
    """
    Stub for the automated issue-remediation workflow triggered post-audit.

    In production this would:
    1. Parse the generated audit report for flagged anomalies and critical findings.
    2. Create remediation tasks in the configured ITSM / project-management system
       for each identified issue.
    3. Assign tasks to the relevant agent owners or governance team members.
    4. Set SLA deadlines based on AIVSS severity (Critical → 48 h, High → 7 days, etc.).
    5. Track and report remediation progress back to the audit record.
    """
    print("[Fix Issues] Extracting flagged anomalies and critical findings from the audit report...")
    print("[Fix Issues] Creating remediation tasks for identified issues...")
    print("[Fix Issues] ⚠️  Automated remediation is advisory only — all task assignments require human confirmation.")
    # TODO: Replace with real ITSM integration (ServiceNow, Jira, Azure DevOps, etc.)


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()