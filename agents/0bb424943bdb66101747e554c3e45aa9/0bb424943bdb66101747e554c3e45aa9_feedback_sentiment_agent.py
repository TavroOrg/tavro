"""
Feedback Sentiment Agent
========================
Tavro ID: 0bb424943bdb66101747e554c3e45aa9
File: 0bb424943bdb66101747e554c3e45aa9_feedback_sentiment_agent.py

Agent Description:
    This agent classifies the sentiment of customer feedback and triggers escalation
    processes for negative or urgent cases. It is designed for support teams and
    customer service managers who need timely insights and automated escalation of
    critical feedback.

Risk Classification: Unknown | Risk Score: 4.24
EU AI Act Category: Other | AIVSS Score: 5.05

Tools:
    - Get Feedback: Retrieves customer feedback records for analysis.
    - Escalate Negative Feedback: Triggers escalation workflows for urgent or negative cases.

Data Sources:
    - Feedback Sentiment Agent

PII: No | PHI: No | PCI: No

Governance Status: Not set (UNAPPROVED - see governance warning in system prompt)
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
class FeedbackRecord:
    """Represents a single customer feedback entry from the Feedback Sentiment Agent data source."""
    feedback_id: str
    customer_id: str
    submission_timestamp: str
    channel: str                     # e.g. "email", "chat", "survey", "social"
    product_or_service: str
    feedback_text: str
    rating: Optional[int] = None     # 1-5 star rating if provided
    agent_id: Optional[str] = None   # Support agent who handled the interaction
    ticket_id: Optional[str] = None  # Associated support ticket
    tags: List[str] = field(default_factory=list)
    language: str = "en"
    raw_metadata: dict = field(default_factory=dict)


@dataclass
class EscalationRecord:
    """Represents an escalation event triggered by the agent."""
    escalation_id: str
    feedback_id: str
    sentiment_label: str             # "negative" | "neutral" | "positive"
    sentiment_score: float           # Confidence score 0.0-1.0
    urgency_level: str               # "low" | "medium" | "high" | "critical"
    escalation_reason: str
    assigned_team: str
    assigned_agent: Optional[str] = None
    escalation_timestamp: Optional[str] = None
    sla_deadline: Optional[str] = None
    notes: str = ""
    status: str = "open"


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def get_feedback(
    limit: int = 50,
    channel: Optional[str] = None,
    since_timestamp: Optional[str] = None,
    feedback_id: Optional[str] = None
) -> List[FeedbackRecord]:
    """
    Retrieve customer feedback records from the feedback data source.

    Args:
        limit: Maximum number of feedback records to retrieve (default 50).
        channel: Optional filter by channel (e.g. "email", "chat", "survey").
        since_timestamp: Optional ISO-8601 timestamp to fetch records after this time.
        feedback_id: Optional specific feedback record ID to retrieve.

    Returns:
        A list of FeedbackRecord objects populated with feedback data.
    """
    # TODO: Replace with real integration
    return []


def escalate_negative_feedback(
    feedback_id: str,
    sentiment_label: str,
    sentiment_score: float,
    urgency_level: str,
    escalation_reason: str,
    assigned_team: str,
    assigned_agent: Optional[str] = None,
    notes: str = ""
) -> EscalationRecord:
    """
    Trigger an escalation workflow for a feedback record that has been classified
    as negative or urgent.

    Args:
        feedback_id: The unique identifier of the feedback record being escalated.
        sentiment_label: Sentiment classification ("negative", "neutral", "positive").
        sentiment_score: Confidence score of the sentiment classification (0.0-1.0).
        urgency_level: Escalation urgency ("low", "medium", "high", "critical").
        escalation_reason: Human-readable explanation of why escalation was triggered.
        assigned_team: Name of the team responsible for handling the escalation.
        assigned_agent: Optional specific agent to assign the escalation to.
        notes: Additional context or instructions for the escalation handler.

    Returns:
        An EscalationRecord confirming the escalation was created.
    """
    # TODO: Replace with real integration
    return EscalationRecord(
        escalation_id="ESC-STUB-001",
        feedback_id=feedback_id,
        sentiment_label=sentiment_label,
        sentiment_score=sentiment_score,
        urgency_level=urgency_level,
        escalation_reason=escalation_reason,
        assigned_team=assigned_team,
        assigned_agent=assigned_agent,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Claude Tool Definitions
# ---------------------------------------------------------------------------

TOOLS: List[dict] = [
    {
        "name": "get_feedback",
        "description": (
            "Retrieve customer feedback records from the feedback data source. "
            "Supports filtering by channel, timestamp range, or a specific feedback ID. "
            "Returns structured feedback entries ready for sentiment analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of feedback records to retrieve. Defaults to 50.",
                    "default": 50,
                    "minimum": 1,
                    "maximum": 500,
                },
                "channel": {
                    "type": "string",
                    "description": "Optional channel filter (e.g. 'email', 'chat', 'survey', 'social').",
                },
                "since_timestamp": {
                    "type": "string",
                    "description": "Optional ISO-8601 timestamp. Only return feedback submitted after this time.",
                },
                "feedback_id": {
                    "type": "string",
                    "description": "Optional specific feedback record ID to retrieve a single entry.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "escalate_negative_feedback",
        "description": (
            "Trigger an escalation workflow for customer feedback that has been classified "
            "as negative, urgent, or meeting predefined escalation criteria. "
            "Creates an escalation record and notifies the appropriate team."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "feedback_id": {
                    "type": "string",
                    "description": "The unique identifier of the feedback record being escalated.",
                },
                "sentiment_label": {
                    "type": "string",
                    "enum": ["positive", "neutral", "negative"],
                    "description": "The sentiment classification determined by analysis.",
                },
                "sentiment_score": {
                    "type": "number",
                    "description": "Confidence score for the sentiment classification, between 0.0 and 1.0.",
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
                "urgency_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": (
                        "Urgency of the escalation. 'critical' for safety/legal risks or "
                        "severe dissatisfaction; 'high' for strong negative sentiment; "
                        "'medium' for moderate concerns; 'low' for borderline cases."
                    ),
                },
                "escalation_reason": {
                    "type": "string",
                    "description": "Clear, human-readable explanation of why this feedback is being escalated.",
                },
                "assigned_team": {
                    "type": "string",
                    "description": "Name of the team responsible for resolving the escalation (e.g. 'Customer Success', 'Tier-2 Support').",
                },
                "assigned_agent": {
                    "type": "string",
                    "description": "Optional: specific agent name or ID to assign the escalation to.",
                },
                "notes": {
                    "type": "string",
                    "description": "Additional context, suggested resolution steps, or instructions for the handler.",
                },
            },
            "required": [
                "feedback_id",
                "sentiment_label",
                "sentiment_score",
                "urgency_level",
                "escalation_reason",
                "assigned_team",
            ],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Dispatch a tool call from the Claude model to the appropriate tool stub.

    Args:
        name: The tool name as defined in the TOOLS list.
        inputs: The input dictionary provided by Claude.

    Returns:
        The result from the tool function, serialized as a JSON-compatible structure.
    """
    if name == "get_feedback":
        records = get_feedback(
            limit=inputs.get("limit", 50),
            channel=inputs.get("channel"),
            since_timestamp=inputs.get("since_timestamp"),
            feedback_id=inputs.get("feedback_id"),
        )
        return [
            {
                "feedback_id": r.feedback_id,
                "customer_id": r.customer_id,
                "submission_timestamp": r.submission_timestamp,
                "channel": r.channel,
                "product_or_service": r.product_or_service,
                "feedback_text": r.feedback_text,
                "rating": r.rating,
                "agent_id": r.agent_id,
                "ticket_id": r.ticket_id,
                "tags": r.tags,
                "language": r.language,
            }
            for r in records
        ]

    elif name == "escalate_negative_feedback":
        record = escalate_negative_feedback(
            feedback_id=inputs["feedback_id"],
            sentiment_label=inputs["sentiment_label"],
            sentiment_score=inputs["sentiment_score"],
            urgency_level=inputs["urgency_level"],
            escalation_reason=inputs["escalation_reason"],
            assigned_team=inputs["assigned_team"],
            assigned_agent=inputs.get("assigned_agent"),
            notes=inputs.get("notes", ""),
        )
        return {
            "escalation_id": record.escalation_id,
            "feedback_id": record.feedback_id,
            "sentiment_label": record.sentiment_label,
            "urgency_level": record.urgency_level,
            "assigned_team": record.assigned_team,
            "status": record.status,
            "message": (
                f"Escalation {record.escalation_id} created successfully for feedback "
                f"{record.feedback_id} with urgency '{record.urgency_level}'."
            ),
        }

    else:
        raise ValueError(f"Unknown tool: {name!r}")


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
=============================================================================
⚠️  GOVERNANCE WARNING
=============================================================================
This agent's governance status is NOT SET (unapproved). It has not completed
the Tavro AI governance review process. Use this agent in controlled,
supervised environments only. Do not deploy to production until governance
approval is obtained. All outputs must be reviewed by a qualified human
before any operational action is taken.

Risk Classification: Unknown | Risk Score: 4.24 (moderate-elevated)
EU AI Act Category: Other | AIVSS Score: 5.05
=============================================================================

IDENTITY AND ROLE
-----------------
You are the Feedback Sentiment Agent, an AI assistant deployed on the Tavro
AI governance platform (Tavro ID: 0bb424943bdb66101747e554c3e45aa9).

You are an expert in sentiment analysis and escalation workflows. Your primary
users are support teams and customer service managers who rely on you to deliver
timely, accurate sentiment classifications and to automatically escalate critical
or negative feedback to the appropriate teams.

BUSINESS CONTEXT
----------------
Customer feedback is a vital signal for product quality, service excellence, and
customer satisfaction. Negative or urgent feedback — if unaddressed promptly —
can lead to churn, reputational damage, and missed improvement opportunities.
Your role is to ensure that no critical feedback falls through the cracks, and
that the right team is notified at the right time with the right context.

OPERATIONAL INSTRUCTIONS
------------------------
1. Analyze customer feedback to determine sentiment as positive, neutral, or negative.
2. Identify feedback that requires escalation based on sentiment or predefined criteria.
3. Trigger escalation workflows for urgent or negative feedback.
4. Clearly communicate sentiment classification and escalation actions to relevant teams.
5. Maintain accuracy and consistency in sentiment detection and escalation decisions.

ESCALATION CRITERIA
-------------------
Escalate feedback when ANY of the following conditions are met:
- Sentiment is classified as "negative" with a confidence score ≥ 0.65.
- Feedback contains language indicating safety risks, legal threats, or regulatory concerns.
- Feedback explicitly mentions churn intent (e.g. "cancel", "switching", "leaving").
- Rating is 1 or 2 stars AND feedback text indicates strong dissatisfaction.
- Feedback is marked urgent by the source system or contains escalation keywords.

Urgency mapping:
- CRITICAL: Safety/legal risk, threats, regulatory violations.
- HIGH: Strong negative sentiment, churn intent, very low ratings with harsh language.
- MEDIUM: Moderate negativity, repeated complaints, service failures.
- LOW: Borderline negative, minor concerns worth monitoring.

SENTIMENT ANALYSIS APPROACH
----------------------------
- Evaluate the full context of the feedback text, not just keywords.
- Consider rating scores as a calibration signal, but prioritize text meaning.
- Account for sarcasm, understatement, and mixed sentiment.
- When sentiment is ambiguous, lean toward "neutral" and note the uncertainty.
- Provide a confidence score (0.0–1.0) with each classification.

DATA SENSITIVITY GUARDRAILS
----------------------------
This agent operates on feedback data. The configured data sources contain:
  PII: No | PHI: No | PCI: No

While PII/PHI/PCI are not expected, customer feedback text may incidentally contain
personal identifiers. You must:
- Never log, repeat, or store raw feedback text beyond what is needed for analysis.
- Never include customer names, emails, or contact details in escalation notes
  unless they are operationally necessary for resolution.
- Flag any feedback that appears to contain sensitive personal data for human review.

RISK-AWARE GUARDRAILS
----------------------
Given the Unknown risk classification and elevated risk scores:
- Always explain your sentiment classification reasoning transparently.
- Do not take escalation actions autonomously without clear justification.
- When uncertainty is high, recommend human review rather than automated escalation.
- Avoid over-escalating neutral or mildly negative feedback; false positives
  erode trust in the system.
- All escalation decisions should be documented with clear, auditable reasoning.
- Do not infer intent, identity, or demographics beyond what the feedback text supports.

COMMUNICATION STANDARDS
------------------------
- Provide concise, structured summaries of sentiment analysis results.
- Use consistent terminology: "positive", "neutral", "negative" for labels.
- Urgency levels must always be one of: "low", "medium", "high", "critical".
- Escalation reasons must be factual, specific, and actionable.
- When reporting to teams, include: feedback ID, sentiment, urgency, reason, and recommended next steps.
"""


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Run the Feedback Sentiment Agent agentic loop.

    Sends the user message to Claude claude-sonnet-4-6 with the defined tools and system
    prompt. Handles tool calls iteratively until the model produces a final
    text response.

    Args:
        user_message: The input message or task description from the user.

    Returns:
        The final text response from the agent.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages = [
        {"role": "user", "content": user_message}
    ]

    print(f"\n{'='*70}")
    print(f"FEEDBACK SENTIMENT AGENT")
    print(f"Tavro ID: 0bb424943bdb66101747e554c3e45aa9")
    print(f"{'='*70}")
    print(f"User: {user_message}\n")

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant response to conversation
        messages.append({"role": "assistant", "content": response.content})

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Extract final text response
            final_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text
            print(f"Agent: {final_text}")
            return final_text

        elif response.stop_reason == "tool_use":
            # Process all tool calls in this response
            tool_results = []

            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_inputs = block.input
                    tool_use_id = block.id

                    print(f"[Tool Call] {tool_name}({json.dumps(tool_inputs, indent=2)})")

                    try:
                        result = handle_tool_call(tool_name, tool_inputs)
                        result_content = json.dumps(result, default=str)
                        print(f"[Tool Result] {result_content[:300]}{'...' if len(result_content) > 300 else ''}\n")
                    except Exception as exc:
                        result_content = json.dumps({"error": str(exc)})
                        print(f"[Tool Error] {result_content}\n")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": result_content,
                    })

            # Append tool results to conversation and continue
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop reason — return whatever we have
            fallback = ""
            for block in response.content:
                if hasattr(block, "text"):
                    fallback += block.text
            print(f"Agent (unexpected stop '{response.stop_reason}'): {fallback}")
            return fallback


# ---------------------------------------------------------------------------
# Main — Realistic Invocation
# ---------------------------------------------------------------------------

def main():
    """
    Realistic invocation: process the latest batch of customer feedback,
    classify sentiment for each entry, and escalate any negative or urgent
    cases to the appropriate support teams.
    """
    task = (
        "Please retrieve the most recent 20 customer feedback submissions from all channels. "
        "For each piece of feedback, classify the sentiment as positive, neutral, or negative "
        "and provide a confidence score. Identify any feedback that meets escalation criteria — "
        "particularly negative sentiment, churn signals, or urgent language — and trigger "
        "escalation workflows for those cases. Assign critical and high-urgency cases to the "
        "'Customer Success' team and medium/low urgency cases to 'Tier-1 Support'. "
        "After processing, provide a summary report listing: total feedback analyzed, "
        "sentiment distribution (positive/neutral/negative counts), number of escalations "
        "triggered by urgency level, and any notable patterns observed."
    )
    result = run_agent(task)
    return result


# ---------------------------------------------------------------------------
# Approval Workflow & Azure Publishing
# ---------------------------------------------------------------------------

def approval_workflow():
    """
    Governance approval workflow for the Feedback Sentiment Agent.

    Checks the current governance status and guides the agent through the
    Tavro approval process before production deployment.
    """
    governance_status = "Not set"
    risk_score = 4.24
    aivss_score = 5.05

    print(f"\n{'='*70}")
    print("TAVRO GOVERNANCE APPROVAL WORKFLOW")
    print(f"Agent: Feedback Sentiment Agent")
    print(f"Tavro ID: 0bb424943bdb66101747e554c3e45aa9")
    print(f"{'='*70}")
    print(f"Current Governance Status: {governance_status}")
    print(f"Risk Score: {risk_score} | AIVSS Score: {aivss_score}")
    print()

    issues = []

    # Governance status check
    if governance_status not in ("Approved",):
        issues.append(
            "Governance status is not 'Approved'. "
            "Complete the Tavro AI governance review before production deployment."
        )

    # Risk score check
    if risk_score >= 4.0:
        issues.append(
            f"Risk score {risk_score} is elevated (≥4.0). "
            "A full risk assessment and mitigation plan is required."
        )

    # AIVSS score check
    if aivss_score >= 5.0:
        issues.append(
            f"AIVSS score {aivss_score} indicates significant AI vulnerability exposure. "
            "Security review and adversarial testing are recommended."
        )

    # EU AI Act check
    eu_ai_act_category = "Other"
    if eu_ai_act_category not in ("Minimal Risk", "Low Risk"):
        issues.append(
            f"EU AI Act category '{eu_ai_act_category}' requires compliance documentation. "
            "Ensure conformity assessment is complete before EU deployment."
        )

    # Tool integration check
    stub_tools = ["get_feedback", "escalate_negative_feedback"]
    issues.append(
        f"The following tools have stub implementations and must be integrated "
        f"before production use: {', '.join(stub_tools)}."
    )

    if issues:
        print("⚠️  APPROVAL BLOCKED — Issues found:")
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {issue}")
        print()
        print("Action required: Call fix_issues() to resolve all blockers, then re-run approval_workflow().")
        fix_issues(issues)
    else:
        print("✅ All governance checks passed. Agent is approved for production deployment.")
        publish_to_azure()


def publish_to_azure():
    """
    Publish the approved Feedback Sentiment Agent to the Azure production environment.

    This function handles the deployment pipeline: packaging the agent, pushing
    to the Azure AI registry, and registering the agent in the Tavro governance
    dashboard with an 'Approved' status.
    """
    print(f"\n{'='*70}")
    print("AZURE DEPLOYMENT PIPELINE")
    print(f"{'='*70}")

    deployment_config = {
        "agent_id": "0bb424943bdb66101747e554c3e45aa9",
        "agent_name": "Feedback Sentiment Agent",
        "model": "claude-sonnet-4-5",
        "environment": "production",
        "azure_resource_group": os.environ.get("AZURE_RESOURCE_GROUP", "tavro-prod-rg"),
        "azure_workspace": os.environ.get("AZURE_ML_WORKSPACE", "tavro-ai-workspace"),
        "container_registry": os.environ.get("AZURE_CONTAINER_REGISTRY", "tavroregistry.azurecr.io"),
        "deployment_target": "azure-container-apps",
        "scaling": {
            "min_replicas": 1,
            "max_replicas": 5,
            "scale_trigger": "http_requests",
        },
        "monitoring": {
            "enable_logging": True,
            "log_analytics_workspace": os.environ.get("AZURE_LOG_ANALYTICS_WS", "tavro-logs"),
            "alert_on_escalation_failure": True,
            "sentiment_accuracy_threshold": 0.85,
        },
        "governance": {
            "tavro_id": "0bb424943bdb66101747e554c3e45aa9",
            "approval_status": "Approved",
            "audit_trail": True,
            "human_review_required_for_critical": True,
        },
    }

    print(f"Deployment configuration:")
    print(json.dumps(deployment_config, indent=2))
    print()

    # Simulate deployment steps
    steps = [
        "Packaging agent code and dependencies...",
        "Building Docker container image...",
        "Pushing image to Azure Container Registry...",
        "Deploying to Azure Container Apps...",
        "Configuring autoscaling policies...",
        "Enabling Azure Monitor and Log Analytics...",
        "Registering agent in Tavro governance dashboard...",
        "Running post-deployment health checks...",
    ]

    for step in steps:
        print(f"  ▶ {step}")
        # TODO: Replace with real Azure SDK calls (azure-ai-ml, azure-mgmt-containerinstance, etc.)

    print()
    print("✅ Deployment complete. Agent is live in Azure production environment.")
    print(f"   Endpoint: https://feedback-sentiment-agent.{deployment_config['azure_resource_group']}.azurecontainerapps.io")
    print(f"   Governance Dashboard: https://tavro.ai/agents/{deployment_config['agent_id']}")


def fix_issues(issues: Optional[List[str]] = None):
    """
    Attempt to automatically resolve known governance and integration issues
    for the Feedback Sentiment Agent.

    Args:
        issues: Optional list of issue descriptions to address. If None,
                runs a full diagnostic and fix pass.
    """
    print(f"\n{'='*70}")
    print("AUTO-REMEDIATION — Fixing Governance Issues")
    print(f"{'='*70}")

    if issues is None:
        issues = [
            "Governance status not set.",
            "Tool stubs require real integration.",
            "Risk assessment documentation missing.",
        ]

    remediation_map = {
        "governance": (
            "ACTION: Submit governance review request in Tavro dashboard at "
            "https://tavro.ai/agents/0bb424943bdb66101747e554c3e45aa9/review. "
            "Attach model card, data lineage, and intended use documentation."
        ),
        "risk": (
            "ACTION: Complete risk assessment using the Tavro Risk Framework. "
            "Document mitigations for elevated risk score (4.24). "
            "Engage the AI Risk team for sign-off."
        ),
        "aivss": (
            "ACTION: Conduct adversarial testing (prompt injection, data poisoning). "
            "Enable input sanitisation and output filtering in production. "
            "Review OWASP LLM Top 10 checklist."
        ),
        "tool": (
            "ACTION: Replace stub implementations in get_feedback() and "
            "escalate_negative_feedback() with production integrations. "
            "Connect to your CRM/helpdesk API and escalation platform (e.g. Zendesk, Jira)."
        ),
        "eu ai act": (
            "ACTION: Prepare EU AI Act conformity assessment documentation. "
            "Designate an EU representative. Register in the EU AI database if required."
        ),
    }

    print("Identified issues and recommended remediation steps:\n")
    for i, issue in enumerate(issues, 1):
        print(f"Issue {i}: {issue}")
        issue_lower = issue.lower()
        for keyword, action in remediation_map.items():
            if keyword in issue_lower:
                print(f"  → {action}")
                break
        else:
            print(
                f"  → ACTION: Review issue manually and update the Tavro governance record. "
                f"Contact the AI governance team at governance@tavro.ai for assistance."
            )
        print()

    print(
        "Once all issues are resolved, re-run approval_workflow() to complete "
        "the governance review and proceed to deployment."
    )


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()