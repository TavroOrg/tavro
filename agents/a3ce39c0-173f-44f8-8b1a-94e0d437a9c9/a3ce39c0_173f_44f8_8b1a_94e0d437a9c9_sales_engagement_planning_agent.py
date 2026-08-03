"""
Sales Engagement Planning Agent
================================
Agent:      Sales Engagement Planning Agent
Tavro ID:   a3ce39c0-173f-44f8-8b1a-94e0d437a9c9
File:       a3ce39c0_173f_44f8_8b1a_94e0d437a9c9_sales_engagement_planning_agent.py

Role:
    Support pharmaceutical sales representatives in preparing for interactions
    with healthcare providers by analyzing relevant commercial, clinical, and
    engagement data to generate compliant, data-driven insights.

Tools (1):
    - Tool 1: (name/description not yet configured — stub provided)

Data Sources:
    - sales_engagement_data_source
    - Sales Engagement Planning Agent

Data Sensitivity:
    PII: Yes  |  PHI: Yes  |  PCI: No

Risk Classification: Unknown | Score: N/A
EU AI Act: N/A | AIVSS: N/A

Governance Status: Not set
"""

import os
import json
from dataclasses import dataclass, field
from typing import Optional, List, Any

import anthropic
from dotenv import load_dotenv

load_dotenv()


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class SalesEngagementDataSource:
    """
    Represents a record from the sales_engagement_data_source.
    Contains PII and PHI fields — handle with strict access controls.
    """
    # Physician / HCP identity
    physician_id: str                          # PII — unique provider identifier
    physician_name: str                        # PII — full legal name
    physician_npi: str                         # PII — National Provider Identifier
    specialty: str
    practice_name: str
    practice_address: str                      # PII — physical location
    practice_city: str
    practice_state: str
    practice_zip: str                          # PII — zip code

    # Engagement history
    last_interaction_date: Optional[str] = None
    last_interaction_type: Optional[str] = None   # e.g., "in-person", "phone", "email"
    total_interactions_ytd: int = 0
    last_discussed_topics: List[str] = field(default_factory=list)
    representative_notes: Optional[str] = None    # PII — may contain patient context

    # Prescribing data (PHI-adjacent — aggregated Rx trends)
    drug_prescribed: Optional[str] = None
    prescribing_volume_last_quarter: Optional[int] = None  # PHI — prescribing behavior
    prescribing_trend: Optional[str] = None                # PHI — e.g., "increasing", "flat"
    therapeutic_area_focus: Optional[str] = None
    competing_drugs_prescribed: List[str] = field(default_factory=list)

    # Payer / formulary data
    primary_payer_mix: Optional[str] = None
    formulary_status: Optional[str] = None        # e.g., "Tier 2 preferred"
    prior_auth_required: bool = False
    step_therapy_required: bool = False

    # Clinical interests
    clinical_study_interests: List[str] = field(default_factory=list)
    conference_attendance: List[str] = field(default_factory=list)
    published_research_topics: List[str] = field(default_factory=list)


@dataclass
class SalesEngagementPlanningAgentDataSource:
    """
    Internal agent configuration and planning data source.
    Used to store agent-level context, output history, and review logs.
    Contains PII tied to sales representative identity.
    """
    # Sales representative identity
    rep_id: str                                # PII — employee identifier
    rep_name: str                              # PII — full name
    rep_email: str                             # PII — corporate email
    rep_territory: str
    rep_region: str

    # Planning session metadata
    session_id: str
    session_timestamp: str
    target_physician_id: str                   # PII — links back to physician record
    planning_objective: Optional[str] = None

    # Generated outputs
    generated_insights: List[str] = field(default_factory=list)
    compliance_flags: List[str] = field(default_factory=list)
    data_quality_notes: List[str] = field(default_factory=list)
    recommended_discussion_themes: List[str] = field(default_factory=list)

    # Review and approval
    human_review_required: bool = True
    reviewer_id: Optional[str] = None         # PII — reviewer employee identifier
    reviewer_name: Optional[str] = None       # PII — reviewer full name
    review_timestamp: Optional[str] = None
    review_status: Optional[str] = None       # e.g., "pending", "approved", "rejected"
    review_notes: Optional[str] = None

    # Audit trail
    approved_for_use: bool = False
    audit_log_entries: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def retrieve_physician_engagement_data(
    physician_id: str,
    include_prescribing_history: bool = True,
    include_payer_data: bool = True,
    lookback_months: int = 12,
) -> dict:
    """
    Retrieve comprehensive physician engagement data from the
    sales_engagement_data_source including interaction history,
    prescribing trends, formulary status, and clinical interests.

    Args:
        physician_id:                Unique identifier for the healthcare provider.
        include_prescribing_history: Whether to include Rx trend data (PHI-adjacent).
        include_payer_data:          Whether to include payer/formulary information.
        lookback_months:             Number of months of historical data to retrieve.

    Returns:
        dict: Structured physician engagement record.
    """
    # TODO: Replace with real integration
    return {}


# ---------------------------------------------------------------------------
# TOOLS list — Claude tool definitions
# ---------------------------------------------------------------------------

TOOLS: List[dict] = [
    {
        "name": "retrieve_physician_engagement_data",
        "description": (
            "Retrieve comprehensive physician engagement and prescribing data for a "
            "specified healthcare provider. Returns interaction history, prescribing "
            "volume and trends, payer/formulary coverage status, and clinical interest "
            "areas. Used to support compliant sales engagement planning. "
            "Data may contain PII and PHI — handle in accordance with data governance policy."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "physician_id": {
                    "type": "string",
                    "description": "Unique identifier (NPI or internal ID) for the healthcare provider."
                },
                "include_prescribing_history": {
                    "type": "boolean",
                    "description": "Whether to include prescribing trend data. Defaults to true.",
                    "default": True
                },
                "include_payer_data": {
                    "type": "boolean",
                    "description": "Whether to include payer and formulary coverage data. Defaults to true.",
                    "default": True
                },
                "lookback_months": {
                    "type": "integer",
                    "description": "Number of months of historical engagement data to retrieve. Defaults to 12.",
                    "default": 12
                }
            },
            "required": ["physician_id"]
        }
    }
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Route a tool call by name to the appropriate stub function and
    return the result as a JSON-serialisable object.

    Args:
        name:   Name of the tool as declared in TOOLS.
        inputs: Dictionary of validated input parameters from Claude.

    Returns:
        Any: Tool result ready for inclusion in a ToolResultBlockParam.
    """
    if name == "retrieve_physician_engagement_data":
        result = retrieve_physician_engagement_data(
            physician_id=inputs["physician_id"],
            include_prescribing_history=inputs.get("include_prescribing_history", True),
            include_payer_data=inputs.get("include_payer_data", True),
            lookback_months=inputs.get("lookback_months", 12),
        )
        return result

    # Fallback for any future tools added before dispatcher is updated
    return {
        "error": f"Unknown tool '{name}'. No handler registered.",
        "available_tools": [t["name"] for t in TOOLS]
    }


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
================================================================================
GOVERNANCE WARNING
================================================================================
Governance Status: NOT SET — This agent has not yet received formal governance
approval. All outputs MUST be treated as draft recommendations only and are
subject to mandatory human review before any use in physician-facing activities.
Do not use outputs from this agent in live sales interactions until governance
approval is confirmed.

================================================================================
AGENT IDENTITY AND ROLE
================================================================================
You are the Sales Engagement Planning Agent, an AI assistant embedded in the
Tavro Agent BizOps platform (ID: a3ce39c0-173f-44f8-8b1a-94e0d437a9c9).

Your primary role is to support pharmaceutical sales representatives in planning
for sales calls with doctors, call center agents, and pricing strategy for a drug.
You analyze available commercial, clinical, and engagement data and generate
insights that help guide compliant and informed sales discussions.

You are a preparation tool for sales representatives — not a direct communication
tool for physicians. All outputs serve as internal planning guidance only.

================================================================================
DATA SENSITIVITY GUARDRAILS
================================================================================
This agent processes data containing:
  • PII (Personally Identifiable Information): YES
  • PHI (Protected Health Information): YES
  • PCI (Payment Card Information): NO

Mandatory data handling rules:
1. Never log, echo, or surface raw PII/PHI fields unnecessarily in responses.
2. Refer to physicians using role or specialty context where possible; avoid
   unnecessary repetition of full names or NPI numbers in outputs.
3. Prescribing data is PHI-adjacent — treat aggregated Rx trends with the same
   care as individual patient data.
4. Do not transmit, store, or recommend sharing PII/PHI outside approved systems.
5. If a data retrieval result contains unexpected patient-level data, flag it
   immediately as a data governance concern and do not process it further.

================================================================================
RISK-AWARE GUARDRAILS
================================================================================
Risk Classification: Unknown
Because the risk classification has not been formally determined, apply
conservative guardrails equivalent to a HIGH-RISK classification:
  • Refuse any request that could constitute off-label promotion.
  • Flag every recommendation with a compliance note.
  • Require explicit human review acknowledgement on all final outputs.
  • Do not speculate about drug efficacy, safety, or comparative effectiveness
    beyond approved labeling and validated published evidence.
  • When in doubt, err on the side of caution and flag for human review.

================================================================================
OPERATIONAL INSTRUCTIONS
================================================================================

OBJECTIVE
Support pharmaceutical sales representatives in preparing for interactions with
healthcare providers by analyzing relevant commercial, clinical, and engagement
data and generating insights that help guide compliant and informed sales discussions.

Your task is to review available engagement and prescribing data and generate
recommended insights that sales representatives can use when planning meetings
or calls with healthcare providers.

CORE RULES
- Always base insights on available commercial, clinical, and engagement data.
- Never generate or suggest off-label promotional claims.
- Only reference approved drug indications and validated clinical evidence.
- Do not fabricate prescribing trends, physician behavior, or payer coverage data.
- Clearly distinguish between data-driven insights and inferred recommendations.
- Flag any missing, incomplete, or conflicting data sources.
- Ensure all recommendations remain compliant with pharmaceutical promotional regulations.
- Do not suggest pricing strategies or promotional actions that violate regulatory guidelines.
- Treat all outputs as sales preparation guidance, not instructions for direct
  physician communication.
- Maintain confidentiality of physician and patient-related data.

STEP 1 — RETRIEVE ENGAGEMENT CONTEXT
Gather all relevant inputs for the healthcare provider engagement, including
where available:
  • Physician profile and specialty
  • Previous sales interactions
  • Prescribing history and trends
  • Payer formulary coverage
  • Recent clinical studies related to promoted drugs
  • Treatment guidelines
  • Internal sales performance insights
If important information is missing, note the gap before generating recommendations.

STEP 2 — VALIDATE DATA QUALITY
Review retrieved information for:
  • Outdated prescribing data
  • Missing physician profile details
  • Conflicting payer coverage information
  • Incomplete engagement history
Flag potential inconsistencies before continuing.

STEP 3 — ANALYZE PHYSICIAN ENGAGEMENT PATTERNS
Evaluate the physician's engagement history and prescribing behavior, including:
  • Historical interactions with sales representatives
  • Prescribing patterns within therapeutic areas
  • Response to previous clinical information
  • Areas of clinical interest
Avoid assumptions beyond the available evidence.

STEP 4 — REVIEW CLINICAL AND MARKET CONTEXT
Analyze relevant information that may influence discussions, such as:
  • Newly published clinical studies
  • Treatment guideline updates
  • Formulary or payer coverage changes
  • Therapeutic competition in the market
Only reference validated and approved clinical information.

STEP 5 — GENERATE ENGAGEMENT INSIGHTS
Produce recommended insights that may help guide the sales representative's preparation.
Examples include:
  • Relevant clinical updates
  • Therapeutic insights related to physician specialty
  • Formulary considerations affecting prescribing
  • Discussion themes aligned with the physician's interests
Ensure recommendations remain compliant with pharmaceutical promotional standards.

STEP 6 — IDENTIFY RISKS OR COMPLIANCE CONSIDERATIONS
Highlight potential risks such as:
  • Off-label discussion risk
  • Outdated clinical references
  • Incomplete data sources
  • Payer restrictions affecting prescribing
Clearly flag compliance considerations.

STEP 7 — GENERATE RECOMMENDATIONS
Produce a summary of recommended engagement insights including:
  • Physician context summary
  • Prescribing insights
  • Relevant clinical updates
  • Recommended discussion themes
  • Compliance considerations
Do not generate promotional claims beyond approved drug labeling.

STEP 8 — HUMAN REVIEW SAFEGUARD
Explicitly state that all results require scientist/compliance review before use.

FINAL OUTPUT FORMAT
Use the following structure for all planning outputs:

---
Sales Engagement Planning Summary
==================================
Physician Context
- Specialty:
- Engagement History:
- Prescribing Trends:

Relevant Insights
- Clinical updates related to therapy
- Formulary or payer coverage considerations
- Therapeutic discussion themes

Recommended Preparation Points
1. Key insight
2. Supporting evidence
3. Compliance note

Data Quality Notes
- Missing or incomplete information

Human Review Required
Sales representatives must review and validate all insights before using them
in physician interactions.
---

================================================================================
COMPLIANCE REMINDER
================================================================================
You operate under pharmaceutical promotional compliance standards (e.g., FDA,
ABPI, EFPIA, or applicable regional regulations). All outputs must be consistent
with approved drug labeling. If any request would require departing from these
standards, decline and explain why.
"""


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Execute the Sales Engagement Planning Agent agentic loop.

    Sends the user message to Claude claude-sonnet-4-5, processes tool calls via
    handle_tool_call, and returns the final text response.

    Args:
        user_message: Natural language planning request from a sales representative.

    Returns:
        str: Final agent response containing the Sales Engagement Planning Summary.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages: List[dict] = [
        {"role": "user", "content": user_message}
    ]

    print(f"\n{'='*72}")
    print("SALES ENGAGEMENT PLANNING AGENT — SESSION START")
    print(f"{'='*72}")
    print(f"User Request: {user_message}\n")

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant turn to message history
        messages.append({"role": "assistant", "content": response.content})

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Extract and return final text
            final_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text
            print("\nAGENT RESPONSE:")
            print(final_text)
            return final_text

        elif response.stop_reason == "tool_use":
            # Process all tool_use blocks in this response turn
            tool_results = []

            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_inputs = block.input
                    tool_use_id = block.id

                    print(f"  [TOOL CALL] {tool_name}")
                    print(f"  [INPUTS]    {json.dumps(tool_inputs, indent=2)}")

                    try:
                        result = handle_tool_call(tool_name, tool_inputs)
                        result_content = json.dumps(result) if not isinstance(result, str) else result
                        print(f"  [RESULT]    {result_content[:200]}{'...' if len(result_content) > 200 else ''}\n")
                    except Exception as exc:
                        result_content = json.dumps({
                            "error": f"Tool execution failed: {str(exc)}",
                            "tool": tool_name
                        })
                        print(f"  [ERROR]     {result_content}\n")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": result_content,
                    })

            # Append tool results as a user turn and continue loop
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop reason — surface it and break
            print(f"[WARNING] Unexpected stop_reason: {response.stop_reason}")
            fallback_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    fallback_text += block.text
            return fallback_text or f"Agent stopped unexpectedly: {response.stop_reason}"


# ---------------------------------------------------------------------------
# Main — Realistic Invocation
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Realistic invocation: a sales representative requests a planning summary
    before an upcoming call with a cardiologist who has shown interest in a
    newly approved heart failure medication.
    """
    planning_request = (
        "I have a call tomorrow with physician ID NPI-1234567890, a cardiologist "
        "at Metropolitan Heart Associates. I need help preparing for our discussion "
        "about our recently approved heart failure medication. Can you retrieve their "
        "engagement history and prescribing data, and give me a planning summary "
        "including any relevant clinical updates, formulary considerations for our "
        "territory (Midwest region, primarily Medicare and commercial payer mix), "
        "and recommended discussion themes? Also flag any compliance points I should "
        "be aware of before the call."
    )

    result = run_agent(planning_request)

    print(f"\n{'='*72}")
    print("SESSION COMPLETE — HUMAN REVIEW REQUIRED BEFORE PHYSICIAN INTERACTION")
    print(f"{'='*72}\n")

    return result


# ---------------------------------------------------------------------------
# Approval Workflow
# ---------------------------------------------------------------------------

def approval_workflow() -> None:
    """
    Simulate the Tavro governance approval workflow for this agent.

    Steps:
    1. Submit agent outputs for compliance review.
    2. Await reviewer sign-off.
    3. Publish to Azure if approved; log issues if rejected.

    Note: Governance status is currently 'Not set'. All outputs are
    provisional and require formal approval before production use.
    """
    print("\n" + "="*72)
    print("APPROVAL WORKFLOW — Sales Engagement Planning Agent")
    print("Tavro ID: a3ce39c0-173f-44f8-8b1a-94e0d437a9c9")
    print("="*72)

    governance_status = "Not set"
    print(f"  Current Governance Status : {governance_status}")
    print(f"  Risk Classification       : Unknown")
    print(f"  PII Present               : Yes")
    print(f"  PHI Present               : Yes")
    print()

    # Step 1: Submit for review
    print("  [STEP 1] Submitting agent session outputs for compliance review...")
    review_record = SalesEngagementPlanningAgentDataSource(
        rep_id="REP-00042",
        rep_name="Jane Smith",                  # PII
        rep_email="jane.smith@pharma.example",  # PII
        rep_territory="Midwest",
        rep_region="Central",
        session_id="SESSION-20240101-001",
        session_timestamp="2024-01-01T09:00:00Z",
        target_physician_id="NPI-1234567890",   # PII
        planning_objective="Pre-call planning for heart failure drug discussion",
        human_review_required=True,
        review_status="pending",
        audit_log_entries=[
            "2024-01-01T09:00:00Z — Agent session initiated by REP-00042",
            "2024-01-01T09:05:00Z — Engagement data retrieved for NPI-1234567890",
            "2024-01-01T09:06:00Z — Planning summary generated",
            "2024-01-01T09:06:00Z — Submitted for compliance review",
        ]
    )
    print(f"  Review record created for session: {review_record.session_id}")
    print(f"  Review status: {review_record.review_status}")

    # Step 2: Simulate reviewer response
    print("\n  [STEP 2] Awaiting human reviewer sign-off...")
    print("  NOTE: Governance status is 'Not set'. Automatic approval is BLOCKED.")
    print("  A qualified compliance reviewer must manually approve before publication.")

    simulated_review_approved = False  # Conservative default — governance not approved
    review_record.review_status = "pending_governance_approval"
    review_record.review_notes = (
        "Agent governance status is 'Not set'. Outputs cannot be approved for "
        "production use until formal governance classification is completed and "
        "risk assessment is finalized."
    )

    # Step 3: Branch on outcome
    if simulated_review_approved:
        publish_to_azure(review_record)
    else:
        fix_issues(review_record)

    print("\n  [AUDIT LOG]")
    for entry in review_record.audit_log_entries:
        print(f"    {entry}")

    print("\n  Approval workflow complete.")
    print("="*72 + "\n")


def publish_to_azure(review_record: SalesEngagementPlanningAgentDataSource) -> None:
    """
    Publish an approved agent session record to the Azure-hosted
    Tavro BizOps data store.

    This function is called only when a human reviewer has formally
    approved the agent outputs and governance status is confirmed.

    Args:
        review_record: The completed and approved planning session record.
    """
    print("\n  [PUBLISH] Publishing approved session record to Azure...")
    # TODO: Replace with real Azure Blob Storage or Cosmos DB integration
    # e.g., BlobServiceClient(...).get_container_client("tavro-agent-outputs")
    #         .upload_blob(name=review_record.session_id, data=json.dumps(...))

    review_record.approved_for_use = True
    review_record.review_status = "approved"
    review_record.audit_log_entries.append(
        f"PUBLISHED — Session {review_record.session_id} approved and published to Azure."
    )
    print(f"  Session {review_record.session_id} successfully published.")
    print("  Status: APPROVED FOR USE by sales representative.")


def fix_issues(review_record: SalesEngagementPlanningAgentDataSource) -> None:
    """
    Handle a rejected or pending-governance agent session record.

    Logs the blocking reasons, notifies the sales representative, and
    records remediation actions required before re-submission.

    Args:
        review_record: The session record that failed approval.
    """
    print("\n  [FIX ISSUES] Session requires remediation before use.")
    print(f"  Review Status : {review_record.review_status}")
    print(f"  Review Notes  : {review_record.review_notes}")

    remediation_steps = [
        "Complete formal governance classification for Tavro ID a3ce39c0-173f-44f8-8b1a-94e0d437a9c9.",
        "Conduct and document a formal risk assessment (EU AI Act and AIVSS).",
        "Obtain compliance officer sign-off on agent system prompt and tool definitions.",
        "Validate data source PII/PHI handling against organisational data governance policy.",
        "Re-submit agent session outputs for human review once governance is approved.",
    ]

    print("\n  Required Remediation Steps:")
    for i, step in enumerate(remediation_steps, 1):
        print(f"    {i}. {step}")

    review_record.audit_log_entries.append(
        f"BLOCKED — Session {review_record.session_id} cannot be published. "
        f"Reason: {review_record.review_notes}"
    )
    review_record.approved_for_use = False

    # TODO: Replace with real notification integration (e.g., email, Slack, ServiceNow)
    print(
        f"\n  [NOTIFICATION] Sales representative REP-{review_record.rep_id} notified: "
        "Planning outputs are NOT approved for use. Contact your compliance team."
    )


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()