"""
Plan Work AI Agent
==================
Agent:      Plan work AI agent
Tavro ID:   4515e0fa3bb262101888f0ec73e45af2
File:       4515e0fa3bb262101888f0ec73e45af2_plan_work_ai_agent.py

Description:
    This agent is designed to analyze the prioritized list and effort estimates
    from the related records to determine estimated completion dates for all tasks
    and create a work plan for the customer.

Risk Classification: Unknown
Risk Score:          2.64
EU AI Act Category:  Other
AIVSS Score:         3.05

Tools:               1 (unnamed/generic stub)
Data Sources:        None
PII: No | PHI: No | PCI: No

Governance Status:   Not set
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
class Task:
    """Represents a single task/incident in the work queue."""
    number: str                          # e.g. INC0000052
    short_description: str
    priority: int                        # 1=Critical, 2=High, 3=Moderate, 4=Low
    priority_label: str                  # e.g. "1 - Critical"
    effort_hours: float                  # estimated effort in decimal hours
    sla_breach: bool = False             # whether SLA is breached or at risk
    sentiment: str = "Neutral"          # Positive / Neutral / Negative / Urgent
    assigned_to: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class WorkPlanEntry:
    """A single entry in the generated work plan schedule."""
    number: str
    short_description: str
    priority: str
    estimated_start_date: str           # ISO datetime string
    estimated_completion_date: str      # ISO datetime string
    estimated_total_hours: str          # human-readable e.g. "3 hours 30 minutes"
    reason: str


@dataclass
class WorkPlan:
    """The complete work plan produced by the agent."""
    plan_date: str
    total_tasks: int
    entries: List[WorkPlanEntry] = field(default_factory=list)
    summary: Optional[str] = None


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def fetch_prioritized_task_list(queue_name: str = "default") -> List[Dict]:
    """
    Retrieve the current prioritized list of tasks/incidents with effort
    estimates from the underlying service management platform.

    Args:
        queue_name: The name or identifier of the work queue to fetch.

    Returns:
        A list of task dictionaries containing number, description, priority,
        effort_hours, sla_breach, sentiment, and other metadata.
    """
    # TODO: Replace with real integration
    return [
        {
            "number": "INC0000052",
            "short_description": "Zscaler App Mass Outage",
            "priority": 1,
            "priority_label": "1 - Critical",
            "effort_hours": 3.5,
            "sla_breach": True,
            "sentiment": "Urgent",
            "assigned_to": "Network Team",
            "category": "Network",
            "notes": "Multiple users affected. Executive escalation active.",
        },
        {
            "number": "INC0000078",
            "short_description": "Email Server Intermittent Failures",
            "priority": 2,
            "priority_label": "2 - High",
            "effort_hours": 2.0,
            "sla_breach": False,
            "sentiment": "Negative",
            "assigned_to": "Messaging Team",
            "category": "Email",
            "notes": "Intermittent SMTP relay errors reported by 15 users.",
        },
        {
            "number": "RITM0000231",
            "short_description": "Provision VPN Access for New Hire Batch",
            "priority": 3,
            "priority_label": "3 - Moderate",
            "effort_hours": 1.5,
            "sla_breach": False,
            "sentiment": "Neutral",
            "assigned_to": "Identity Team",
            "category": "Access Management",
            "notes": "10 new hires starting Monday require VPN credentials.",
        },
        {
            "number": "INC0000095",
            "short_description": "Printer Offline – Finance Floor",
            "priority": 4,
            "priority_label": "4 - Low",
            "effort_hours": 0.75,
            "sla_breach": False,
            "sentiment": "Neutral",
            "assigned_to": "Desktop Support",
            "category": "Hardware",
            "notes": "Single printer offline, workaround available.",
        },
        {
            "number": "CHG0000017",
            "short_description": "Patch Tuesday – Server Patching Cycle",
            "priority": 2,
            "priority_label": "2 - High",
            "effort_hours": 4.0,
            "sla_breach": False,
            "sentiment": "Positive",
            "assigned_to": "Server Team",
            "category": "Change Management",
            "notes": "Scheduled maintenance window required. 12 servers in scope.",
        },
    ]


# ---------------------------------------------------------------------------
# TOOLS Definition (Claude tool schema)
# ---------------------------------------------------------------------------

TOOLS: List[Dict] = [
    {
        "name": "fetch_prioritized_task_list",
        "description": (
            "Retrieve the current prioritized list of tasks, incidents, requests, "
            "and change records along with their effort estimates from the service "
            "management platform. Returns task numbers, descriptions, priorities, "
            "estimated effort hours, SLA breach status, sentiment indicators, and "
            "any relevant notes that should inform scheduling decisions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queue_name": {
                    "type": "string",
                    "description": (
                        "The identifier of the work queue to retrieve. "
                        "Defaults to 'default' if not specified."
                    ),
                    "default": "default",
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
    Dispatch an incoming tool-use request from Claude to the appropriate
    Python function and return the serialisable result.

    Args:
        name:   The tool name as declared in TOOLS.
        inputs: The argument dictionary provided by Claude.

    Returns:
        A JSON-serialisable value (dict, list, str, etc.).

    Raises:
        ValueError: If the tool name is not recognised.
    """
    if name == "fetch_prioritized_task_list":
        queue_name = inputs.get("queue_name", "default")
        result = fetch_prioritized_task_list(queue_name=queue_name)
        return result

    raise ValueError(f"Unknown tool requested by model: '{name}'")


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
⚠️  GOVERNANCE WARNING ⚠️
This agent's governance status is currently "Not set". It has NOT been formally
approved for production use. Outputs must be reviewed by a human supervisor
before being acted upon. Do not make autonomous decisions without oversight.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY & ROLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are the Plan Work AI Agent, a specialist scheduling assistant operating
within the Tavro AI governance platform (ID: 4515e0fa3bb262101888f0ec73e45af2).

Your sole purpose is to analyse prioritised task lists and effort estimates,
then generate a clear, structured daily work plan with realistic estimated
start and completion timestamps for every task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IT service desks and operations teams receive large volumes of concurrent
incidents, requests, and change tasks. Without a structured daily work plan
it is difficult for individuals and teams to sequence their work optimally.
This agent addresses that problem by consuming the prioritised backlog and
producing an actionable, time-blocked schedule that accounts for SLA deadlines,
priority bands, effort estimates, and sentiment signals.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPERATIONAL INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Analyse the prioritised list of tasks and effort estimates to determine
   estimated start and completion dates and times for all tasks and provide
   a work plan for a day.

2. Create a structured work plan using the prioritised list and completion
   estimates.

3. Provide a detailed summary of the schedule, highlighting timelines, SLAs,
   priorities, and sentiments that justify each task's position in the work
   plan based on the prioritisation reasoning insights.

4. As a final step, always OUTPUT the schedule to the user with the following
   fields in the exact format shown below for EVERY task:

-------
<Number>: <Short description>
Priority: <priority label>
Estimated start date: <YYYY-MM-DD HH:MM:SS>
Estimated completion date: <YYYY-MM-DD HH:MM:SS>
Estimated Total hours: <X hours Y minutes>
Reason: <detailed summary>
-------

Assume the working day starts at 08:00 unless the user specifies otherwise.
Schedule tasks back-to-back in priority order, carrying over to the next day
if total effort exceeds the remaining working hours (assume 8-hour day).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA SENSITIVITY GUARDRAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- PII: Not present in data sources. Do NOT request, store, or output PII.
- PHI: Not present in data sources. Do NOT request, store, or output PHI.
- PCI: Not present in data sources. Do NOT request, store, or output PCI.
- If task descriptions accidentally contain personal data, redact before output.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RISK-AWARE GUARDRAILS  (Risk Score: 2.64 | AIVSS: 3.05 | EU AI Act: Other)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Risk classification is UNKNOWN. Treat all outputs as advisory only.
- Always surface uncertainty — never assert schedules as guaranteed.
- Recommend human review before the plan is committed to assignees.
- Do not autonomously reassign tasks between teams or personnel.
- Flag any assumption you make so a human can validate it.
- If conflicting priorities or SLA data make scheduling ambiguous, state the
  conflict clearly and present alternative scheduling options.
- Refuse requests to manipulate priorities for non-operational reasons.
""".strip()


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Execute the Plan Work AI Agent agentic loop.

    Sends the user message to Claude claude-sonnet-4-5, handles any tool-use
    requests, and returns the final text response containing the work plan.

    Args:
        user_message: The natural-language request from the operator/user.

    Returns:
        The final text output from the model (the formatted work plan).
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages: List[Dict] = [
        {"role": "user", "content": user_message}
    ]

    print(f"\n{'='*70}")
    print("Plan Work AI Agent  |  Tavro ID: 4515e0fa3bb262101888f0ec73e45af2")
    print(f"{'='*70}")
    print(f"User request: {user_message}\n")

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant turn
        messages.append({"role": "assistant", "content": response.content})

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Extract and return the final text block
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return ""

        if response.stop_reason == "tool_use":
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_inputs = block.input
                tool_use_id = block.id

                print(f"[Tool Call] {tool_name}({json.dumps(tool_inputs)})")

                try:
                    result = handle_tool_call(tool_name, tool_inputs)
                    result_content = json.dumps(result, default=str)
                    print(f"[Tool Result] Returned {len(result) if isinstance(result, list) else 1} item(s)")
                except Exception as exc:
                    result_content = json.dumps({"error": str(exc)})
                    print(f"[Tool Error] {exc}")

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": result_content,
                })

            # Append tool results as user turn and continue loop
            messages.append({"role": "user", "content": tool_results})
            continue

        # Unexpected stop reason – return whatever text is available
        for block in response.content:
            if hasattr(block, "text"):
                return block.text
        return f"[Agent stopped with reason: {response.stop_reason}]"


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Realistic invocation: request a full-day work plan starting today at 08:00
    for the default service desk queue, including SLA-aware sequencing.
    """
    import datetime

    today = datetime.date.today().isoformat()

    user_request = (
        f"Good morning. Today is {today}. Please fetch the current prioritised "
        "task list from the default queue, then build me a complete work plan "
        "for today starting at 08:00. Sequence tasks by priority, account for "
        "SLA breaches and sentiment, calculate realistic start and completion "
        "timestamps based on the effort estimates, and output the full schedule "
        "in the standard format. Flag any SLA risks or scheduling conflicts."
    )

    result = run_agent(user_request)

    print("\n" + "="*70)
    print("WORK PLAN OUTPUT")
    print("="*70)
    print(result)
    print("="*70 + "\n")


# ---------------------------------------------------------------------------
# Approval Workflow
# ---------------------------------------------------------------------------

def approval_workflow() -> None:
    """
    Simulate the Tavro governance approval workflow for this agent.

    In a real deployment this would:
    - Submit the agent configuration and outputs to the Tavro review board.
    - Block promotion to production until a human approver signs off.
    - Record the approval decision and timestamp in the audit log.
    """
    print("\n[Approval Workflow] Initiating governance review...")
    print("  Agent ID  : 4515e0fa3bb262101888f0ec73e45af2")
    print("  Status    : Not set (pending first review)")
    print("  Risk Score: 2.64 | AIVSS: 3.05 | EU AI Act: Other")
    print("  Action    : Submitting agent artefacts for human review.")
    print("  ⚠️  Agent is NOT approved. Outputs are advisory only.")
    print("  → Notifying governance team for sign-off before production use.")
    # TODO: Replace with real Tavro API call to submit for approval
    print("[Approval Workflow] Review request queued.\n")


def publish_to_azure() -> None:
    """
    Publish the approved agent to the Azure-hosted Tavro runtime environment.

    In a real deployment this would:
    - Package the agent code and configuration.
    - Push the container image to Azure Container Registry.
    - Deploy or update the Azure Function / Container App / Logic App.
    - Register the published endpoint in Tavro's agent catalogue.
    - Verify the health check endpoint after deployment.
    """
    print("[Publish to Azure] Checking approval status before publish...")
    # Governance gate: do not publish unapproved agents
    approved = False   # TODO: Replace with real approval status check
    if not approved:
        print(
            "[Publish to Azure] ❌ Blocked – agent governance status is 'Not set'. "
            "Obtain approval before publishing to Azure."
        )
        return
    print("[Publish to Azure] ✅ Approved. Packaging and deploying to Azure...")
    # TODO: Replace with real Azure deployment pipeline trigger
    print("[Publish to Azure] Deployment pipeline triggered.\n")


def fix_issues() -> None:
    """
    Iterate on identified issues flagged during approval review or testing.

    In a real deployment this would:
    - Pull the latest issue list from the Tavro governance portal.
    - Log each issue with severity and owner.
    - Apply automated remediations where possible (e.g. prompt adjustments).
    - Re-run validation tests and re-submit for approval.
    """
    issues = [
        {
            "id": "ISS-001",
            "severity": "Medium",
            "description": "Governance status not set – requires formal approval.",
            "remediation": "Submit agent for Tavro governance review.",
        },
        {
            "id": "ISS-002",
            "severity": "Low",
            "description": "Tool stubs not connected to live service management API.",
            "remediation": "Implement fetch_prioritized_task_list with real ITSM connector.",
        },
        {
            "id": "ISS-003",
            "severity": "Low",
            "description": "Risk classification is 'Unknown' – assess and categorise.",
            "remediation": "Complete Tavro risk assessment questionnaire.",
        },
    ]

    print("[Fix Issues] Processing outstanding governance and technical issues...")
    for issue in issues:
        print(
            f"  [{issue['severity']}] {issue['id']}: {issue['description']}\n"
            f"           Remediation: {issue['remediation']}"
        )
    # TODO: Replace with real issue tracking integration (e.g. Jira / Tavro portal)
    print("[Fix Issues] Issue review complete. Re-submission recommended.\n")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()