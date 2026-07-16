"""
Agent: test agent
Tavro ID: bb7f2bc6-6c3f-468b-881f-528a48e966d3
File: bb7f2bc6_6c3f_468b_881f_528a48e966d3_test_agent.py

Metadata:
---------
Risk Classification: Unknown
Risk Score: 5.04
EU AI Act Category: Other
AIVSS Score: 6.05
Governance Status: Risk Assessment is running

Tools (1 total):
  - Name: None | Description: None

Data Sources: None
PII: No | PHI: No | PCI: No

Description:
    Test Agent is a general-purpose agent used for development, experimentation,
    and validation purposes. It allows users to explore agent capabilities,
    verify configurations, and troubleshoot workflows before deploying production
    agents. It serves as a sandbox environment for testing inputs, outputs, and
    overall agent behavior.
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
class AgentSession:
    """Represents a single agent execution session for auditing and tracing."""
    session_id: str
    agent_id: str = "bb7f2bc6-6c3f-468b-881f-528a48e966d3"
    user_message: str = ""
    tool_calls: List[dict] = field(default_factory=list)
    response: str = ""
    status: str = "pending"


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def execute_general_tool(input_data: Optional[str] = None) -> dict:
    """
    General-purpose tool stub for the test agent.

    This tool serves as a placeholder for any real integration during
    development and experimentation phases. Replace the body with actual
    integration logic before promoting to production.

    Args:
        input_data: Optional string input to pass to the tool integration.

    Returns:
        A dictionary containing the tool result or status.
    """
    # TODO: Replace with real integration
    return {
        "status": "stub_executed",
        "input_received": input_data,
        "message": "This is a stub response. Replace with real integration logic.",
    }


# ---------------------------------------------------------------------------
# TOOLS List — Claude tool definitions
# ---------------------------------------------------------------------------

TOOLS: List[dict] = [
    {
        "name": "execute_general_tool",
        "description": (
            "A general-purpose tool stub used during development, experimentation, "
            "and validation. It accepts optional string input and returns a structured "
            "result. Replace this stub with a real integration before production use."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "description": "Optional input string to send to the tool integration.",
                }
            },
            "required": [],
        },
    }
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Dispatch a tool call by name and return the result.

    Args:
        name:   The name of the tool to invoke.
        inputs: A dictionary of input parameters for the tool.

    Returns:
        The result of the tool call, serialisable to JSON.
    """
    if name == "execute_general_tool":
        return execute_general_tool(
            input_data=inputs.get("input_data")
        )

    # Fallback for unknown tools
    return {
        "error": f"Unknown tool '{name}'. No handler registered.",
        "available_tools": [t["name"] for t in TOOLS],
    }


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
⚠️  GOVERNANCE WARNING ⚠️
This agent is currently under active Risk Assessment and has NOT yet received
full governance approval. Do NOT use this agent for production workloads,
sensitive data processing, or any customer-facing operations until the Risk
Assessment is complete and the agent status is set to "Approved".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY & ROLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are "Test Agent", a general-purpose AI assistant operating within the
Tavro AI governance platform (Agent ID: bb7f2bc6-6c3f-468b-881f-528a48e966d3).

Your primary role is to support developers, engineers, and stakeholders in:
  • Exploring and validating agent capabilities.
  • Verifying configurations and tool integrations.
  • Troubleshooting workflows and input/output behaviour.
  • Serving as a safe sandbox before production deployment.

You do NOT have a specialised domain role. Respond helpfully to general
requests within the boundaries defined below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No specific AI use case has been assigned to this agent. It operates as a
development and experimentation sandbox. Use it to validate ideas and
configurations rather than to drive business-critical decisions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPERATIONAL INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA SENSITIVITY GUARDRAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This agent is configured with the following data sensitivity flags:
  • PII (Personally Identifiable Information): NOT expected — do not store,
    log, or process real personal data in this sandbox environment.
  • PHI (Protected Health Information): NOT expected — do not handle any
    health-related personal data.
  • PCI (Payment Card Industry data): NOT expected — do not handle any
    financial or payment card information.

If a user provides any of the above sensitive data types, politely decline
to process it and advise them to use an appropriately governed agent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RISK-AWARE GUARDRAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Risk Profile:
  • Classification : Unknown (governance assessment in progress)
  • Risk Score     : 5.04 / 10
  • EU AI Act      : Other
  • AIVSS Score    : 6.05

Given the elevated AIVSS score and Unknown risk classification:
  1. Do NOT make autonomous decisions that could have significant real-world
     consequences without explicit human review.
  2. Always surface uncertainty clearly — do not speculate as fact.
  3. Decline requests that ask you to bypass security controls, access
     unauthorised systems, or act outside this sandbox scope.
  4. Flag any unexpected or potentially high-risk inputs to the operator.
  5. Prefer conservative, reversible actions when using tools.
  6. This agent must not be promoted to production until risk classification
     is resolved and governance approval is granted.
""".strip()


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Execute the agentic loop for a given user message.

    Uses claude-sonnet-4-5 with a maximum of 4096 output tokens.
    Handles the standard tool-use loop:
      tool_use → handle_tool_call → tool_result → continue until text response.

    Args:
        user_message: The natural-language input from the user.

    Returns:
        The final text response from the agent.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages: List[dict] = [
        {"role": "user", "content": user_message}
    ]

    print(f"\n[Agent] Processing: {user_message}\n")

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant response to conversation history
        messages.append({"role": "assistant", "content": response.content})

        # If the model is done (no more tool calls), extract and return text
        if response.stop_reason == "end_turn":
            final_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text
            print(f"[Agent] Final response:\n{final_text}\n")
            return final_text

        # Handle tool_use stop reason
        if response.stop_reason == "tool_use":
            tool_results = []

            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_inputs = block.input

                    print(f"[Tool Call] {tool_name} | inputs={json.dumps(tool_inputs)}")

                    result = handle_tool_call(tool_name, tool_inputs)

                    print(f"[Tool Result] {json.dumps(result)}")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })

            # Feed tool results back into the conversation
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop reason — surface the raw content and exit
            print(f"[Agent] Unexpected stop_reason: {response.stop_reason}")
            fallback = " ".join(
                block.text for block in response.content if hasattr(block, "text")
            )
            return fallback or "Agent stopped unexpectedly. Please review logs."


# ---------------------------------------------------------------------------
# Main — realistic test-agent invocation
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Demonstrate the Test Agent by running a representative sandbox validation
    scenario.  Since this agent's purpose is development and experimentation,
    the invocation exercises configuration verification, tool stub execution,
    and basic workflow troubleshooting in a single conversational turn.
    """
    test_message = (
        "Hello Test Agent. Please perform a quick self-check: "
        "1) Confirm your identity and governance status. "
        "2) Execute the general tool with the input 'sandbox-validation-001' "
        "   and report what it returned. "
        "3) Summarise any risks or limitations I should be aware of before "
        "   promoting this agent to production."
    )

    result = run_agent(test_message)

    print("=" * 72)
    print("AGENT OUTPUT")
    print("=" * 72)
    print(result)
    print("=" * 72)


# ---------------------------------------------------------------------------
# Approval Workflow
# ---------------------------------------------------------------------------

def approval_workflow() -> None:
    """
    Tavro governance approval workflow for test agent
    (bb7f2bc6-6c3f-468b-881f-528a48e966d3).

    Checks the current governance status and routes to the appropriate
    downstream action:
      - Approved  → publish_to_azure()
      - Issues    → fix_issues()
      - Otherwise → notify stakeholders that review is pending
    """
    print("\n[Approval Workflow] Evaluating governance status …")

    governance_status: str = "Risk Assessment is running"
    risk_score: float = 5.04
    aivss_score: float = 6.05
    risk_classification: str = "Unknown"

    print(f"  Governance Status  : {governance_status}")
    print(f"  Risk Classification: {risk_classification}")
    print(f"  Risk Score         : {risk_score}")
    print(f"  AIVSS Score        : {aivss_score}")

    # Determine routing
    if governance_status.lower() == "approved":
        print("[Approval Workflow] ✅ Agent is APPROVED. Initiating deployment …")
        publish_to_azure()

    elif any(
        keyword in governance_status.lower()
        for keyword in ("failed", "rejected", "issues", "error")
    ):
        print("[Approval Workflow] ❌ Governance issues detected. Initiating fix workflow …")
        fix_issues()

    else:
        # Pending / Assessment running / Unknown
        print(
            "[Approval Workflow] ⏳ Governance status is not yet resolved.\n"
            "  Action required: Complete the Risk Assessment and obtain formal\n"
            "  approval before scheduling deployment.\n"
            "  Notifying stakeholders — no automated action taken."
        )
        _notify_stakeholders(governance_status, risk_score, aivss_score)


def publish_to_azure() -> None:
    """
    Publish the approved test agent artefacts to Azure.

    Packages the agent configuration, system prompt, and tool definitions,
    then deploys them to the target Azure environment via the Tavro
    deployment pipeline.

    Note: Requires AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and
    AZURE_DEPLOYMENT_TARGET environment variables to be set.
    """
    print("\n[publish_to_azure] Starting Azure deployment …")

    subscription_id = os.environ.get("AZURE_SUBSCRIPTION_ID", "<not-set>")
    resource_group = os.environ.get("AZURE_RESOURCE_GROUP", "<not-set>")
    deployment_target = os.environ.get("AZURE_DEPLOYMENT_TARGET", "<not-set>")

    agent_payload = {
        "agent_id": "bb7f2bc6-6c3f-468b-881f-528a48e966d3",
        "agent_name": "test agent",
        "model": "claude-sonnet-4-5",
        "max_tokens": 4096,
        "tools": TOOLS,
        "system_prompt_hash": hash(SYSTEM_PROMPT),
    }

    print(f"  Subscription : {subscription_id}")
    print(f"  Resource Group: {resource_group}")
    print(f"  Target        : {deployment_target}")
    print(f"  Payload       : {json.dumps(agent_payload, indent=4)}")

    # TODO: Replace with real Azure SDK / REST API deployment call
    # e.g. azure.mgmt.resource or a Tavro deployment client
    print("[publish_to_azure] ✅ Deployment complete (stub — replace with real call).")


def fix_issues() -> None:
    """
    Initiate the remediation workflow for governance issues detected on
    test agent (bb7f2bc6-6c3f-468b-881f-528a48e966d3).

    Retrieves outstanding issues from the Tavro governance API, logs them
    for the engineering team, and creates remediation tasks in the project
    tracker.
    """
    print("\n[fix_issues] Retrieving outstanding governance issues …")

    # Simulated issue list — replace with real Tavro API call
    outstanding_issues = [
        {
            "issue_id": "ISS-001",
            "severity": "HIGH",
            "description": "Risk classification is 'Unknown' — manual risk assessment required.",
            "owner": "AI Governance Team",
        },
        {
            "issue_id": "ISS-002",
            "severity": "MEDIUM",
            "description": "Tool definitions contain null name/description — must be completed.",
            "owner": "Engineering Team",
        },
        {
            "issue_id": "ISS-003",
            "severity": "LOW",
            "description": "AI Use Case fields are unpopulated — link to a formal use case record.",
            "owner": "Product Owner",
        },
    ]

    print(f"  {len(outstanding_issues)} issue(s) found:\n")
    for issue in outstanding_issues:
        print(
            f"  [{issue['severity']}] {issue['issue_id']}: {issue['description']}\n"
            f"    Owner: {issue['owner']}"
        )

    # TODO: Replace with real integration — e.g. Jira, Azure DevOps, ServiceNow
    print(
        "\n[fix_issues] 📋 Remediation tasks have been logged "
        "(stub — replace with real tracker integration)."
    )
    print("[fix_issues] Re-run the approval workflow after issues are resolved.")


def _notify_stakeholders(
    status: str,
    risk_score: float,
    aivss_score: float,
) -> None:
    """
    Internal helper: send a governance status notification to stakeholders.

    Args:
        status:      Current governance status string.
        risk_score:  Numeric risk score (0–10).
        aivss_score: AIVSS score for the agent.
    """
    notification = {
        "agent_id": "bb7f2bc6-6c3f-468b-881f-528a48e966d3",
        "agent_name": "test agent",
        "governance_status": status,
        "risk_score": risk_score,
        "aivss_score": aivss_score,
        "message": (
            "The test agent is pending governance review. "
            "No deployment action has been taken. "
            "Please complete the Risk Assessment at your earliest convenience."
        ),
    }

    print("\n[Notify Stakeholders] Sending notification …")
    print(json.dumps(notification, indent=4))
    # TODO: Replace with real notification integration (email, Slack, Teams, etc.)
    print("[Notify Stakeholders] ✅ Notification sent (stub).")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()