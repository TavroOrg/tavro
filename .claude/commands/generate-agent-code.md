---
description: Fetch the full Tavro ecosystem context for an agent and generate a production-ready Python implementation file, then guide through the Test → Approve → Publish lifecycle.
argument-hint: "<agent_id or agent_name>"
---

You are driving the full agent code lifecycle for a Tavro portal agent.
Follow every phase below in order: **gather context → generate code → test guidance → approval decision → publish or fix**.

---

## Phase 1 — Gather Context (Company → Use Case → Agent Configuration)

### 1a. Fetch the Agent Card

Use `mcp__claude_ai_Tavro_1_0_sandbox__get_agent_card` for: **$ARGUMENTS**

Try `agent_id` first. If the result is null or `NOT_FOUND`, retry with `agent_name`.

Extract the full configuration from the card:

| Config item | Card field |
|---|---|
| **Tools** | `tools` — tool_name, tool_description, input_schema_json_text, output_schema_json_text |
| **Skills** | `knowledge_sources` — name, description |
| **Tables / Data Sources** | `data_sources` — source_object_name, source_object_type, access_level |
| **Columns** | inferred from `data_sources[*].source_object_name` and use case context |
| **Risk Assessment** | `risk_assessment` — risk_classification, blended_risk_score, pii_flag, phi_flag, pci_flag |
| **Applications** | `application` — application_name, criticality, integration_role |
| **Processes** | `process` — process_name, process_stage, criticality |
| **Identification** | `identification` — instruction, role, environment, governance_status |
| **AI Use Cases** | `ai_use_cases` — identifier, name, problem_statement, expected_benefits |

### 1b. Fetch Detailed Risk Summary

Use `mcp__claude_ai_Tavro_1_0_sandbox__get_agent_risk_summary` with the resolved `agent_id`.

This returns the full risk narrative — EU AI Act classification rationale, OWASP AIVSS capability scores, and scenario-level risk scores. Use this to:
- Populate the risk section of the module docstring
- Set the correct risk-aware guardrails in the SYSTEM_PROMPT
- Determine approval criteria in Phase 4

### 1c. Enrich with AI Use Case Context

If `ai_use_cases` is non-empty, call `mcp__claude_ai_Tavro_1_0_sandbox__get_ai_use_case` using the first `identifier` as `use_case_id`.

Capture: `name`, `description`, `problem_statement`, `expected_benefits`, `solution_approach`, `priority`, `status`, `owner`, `of_associated_business_processes` (name, description, business_criticality).

If no use case is linked, note it and continue.

### 1d. Company Context

The available tools do not include a direct company lookup. If `tenant_id` is present on the card, record it as the company/tenant identifier in the docstring. Otherwise note "company context not available".

---

## Phase 2 — Generate Agent Code

Using all gathered context, generate a complete Python implementation file.

### Module docstring
```
Agent:          <agent_name>
Tavro ID:       <agent_id>
Owner:          <owner from use case or card>
Risk:           <risk_classification> | Score: <blended_risk_score> | PII: <Y/N> PHI: <Y/N> PCI: <Y/N>
EU AI Act:      <eu_act_classification from risk summary>
AIVSS Score:    <aivss_score from risk summary>
AI Use Case:    <use_case_name> — <one-line problem_statement>
Tenant:         <tenant_id or "not available">
Tools:          <comma-separated tool names>
Data Sources:   <comma-separated source names>
```

### Imports and setup
```python
import os
import json
from dataclasses import dataclass, field
from typing import Optional, List, Any
import anthropic
from dotenv import load_dotenv

load_dotenv()
```

### Data models — Tables / Columns
For each entry in `data_sources`, define a `@dataclass`:
- Class name: `source_object_name` in PascalCase
- Comment: `source_object_type` and `access_level`
- Inline comments: `# PII` / `# PHI` / `# PCI` on sensitive fields
- Field names: inferred from the source name and use case context

### Tool stubs — Tools
For each tool:
- Snake_case function name matching `tool_name`
- Parameters typed from `input_schema_json_text` (parse JSON if present)
- Return type from `output_schema_json_text` (parse JSON if present)
- Docstring = `tool_description`
- Body: `# TODO: Replace with real integration`

### Skills integration
For each entry in `knowledge_sources`, add a constant:
```python
KNOWLEDGE_SOURCE_<NAME> = {
    "name": "...",
    "description": "..."
}
```
Reference these constants in the SYSTEM_PROMPT.

### TOOLS list
Claude tool definitions for each tool — `name`, `description`, `input_schema` (from `input_schema_json_text` or `{"type": "object", "properties": {}}`).

### Tool dispatcher
```python
def handle_tool_call(name: str, inputs: dict) -> Any:
    ...
```

### SYSTEM_PROMPT
Build a rich, context-aware system prompt with these sections in order:

1. **Governance warning** — if `governance_status` is not "Approved", open with:
   ```
   # ⚠ GOVERNANCE WARNING: This agent has status '<governance_status>'. Do not use in production.
   ```
2. **Role and identity** — from `identification.role` and agent description
3. **Business context** — from the AI Use Case: problem being solved, expected benefits, solution approach, priority
4. **Business process context** — which processes this agent operates in, their stages and criticality (from linked processes)
5. **Application integration** — which applications the agent reads from or writes to, and the integration role
6. **Operational instructions** — verbatim from `identification.instruction`
7. **Knowledge / Skills** — reference the `KNOWLEDGE_SOURCE_*` constants
8. **Data sensitivity guardrails** — auto-generated from data source flags:
   - `contains_pii=true`: "Never log or return raw PII fields. Mask or redact before surfacing to users."
   - `contains_phi=true`: "Redact all PHI before surfacing to end users. Do not persist PHI in logs."
   - `contains_pci=true`: "Never return raw PCI data. Apply tokenization or masking rules at all times."
9. **Risk-aware guardrails** — based on `risk_classification`:
   - **High Risk / Prohibited**: strict human-in-the-loop required; escalate before any irreversible action; log every decision
   - **Medium Risk**: require explicit confirmation before write or delete operations
   - **Other / Low**: standard responsible-use reminder

### Agentic loop
```python
def run_agent(user_message: str) -> str:
    # Uses claude-sonnet-4-6, max_tokens=4096
    # Handles tool_use → handle_tool_call → append result → continue
    # Handles end_turn → return final text
```

### main()
A realistic invocation derived from problem_statement and solution_approach — not a generic placeholder.

Approval Workflow

Generate the following functions in the Python file after main():

def approval_workflow():
    print("\n" + "=" * 72)
    print("APPROVAL PROCESS")
    print("=" * 72)

    print("\n1. Approve")
    print("2. Reject")

    choice = input("\nEnter choice (1/2): ").strip()

    if choice == "1":
        print("\n✓ Agent Approved")
        publish_to_azure()

    elif choice == "2":
        print("\n✗ Agent Rejected")
        fix_issues()

    else:
        print("\nInvalid choice")

def publish_to_azure():
    print("\n## Publish to Azure Foundry")
    print("Display the Phase 5a deployment guidance")

def fix_issues():
    print("\n## Fix the Issue")
    print("Display the Phase 5b remediation checklist")

The generated file must end with:

if __name__ == "__main__":
    main()
    approval_workflow()

---

## Phase 3 — Test in Playground

After writing the file, output a **Testing Checklist** the developer should run before submitting for approval:

```
## Test in Playground — Validate Agent Behavior

Agent: <agent_name>
File:  generated_agents/<filename>.py

Checklist:
[ ] 1. Install dependencies: pip install anthropic python-dotenv
[ ] 2. Set ANTHROPIC_API_KEY in .env
[ ] 3. Run: python generated_agents/<filename>.py
[ ] 4. Verify the agent responds to the golden-path scenario in main()
[ ] 5. Verify each tool stub is called at least once (check console output)
[ ] 6. Verify no raw PII/PHI/PCI values appear in output   ← if sensitivity flags present
[ ] 7. Verify the agent does NOT take irreversible actions without confirmation ← if Medium/High risk
[ ] 8. Replace TODO stubs with real integrations and re-run
```

---

## Phase 4 — Approval Process

Output an **Approval Summary** that a reviewer can use to make the accept/reject decision:

```
## Approval Process — Review & Decision

Agent:               <agent_name>
Risk Classification: <risk_classification>
EU AI Act:           <eu_act_classification>
AIVSS Score:         <aivss_score>
Blended Risk Score:  <blended_risk_score>
Governance Status:   <governance_status>
PII / PHI / PCI:     <flags>
Top Risk Scenarios:  <top 3 scenario names + scores from risk summary>

Approval criteria:
- [ ] All tool stubs replaced with real integrations
- [ ] Data sensitivity guardrails verified in testing
- [ ] AIVSS risk scenarios reviewed and mitigations documented  ← if score > 5.0
- [ ] Human-in-the-loop checkpoints confirmed                   ← if High Risk / Prohibited
- [ ] Governance status updated to "Approved" in Tavro portal

Decision:
  Instead of only printing approval guidance, generate executable Python code that prompts the reviewer:

========================================================================
APPROVAL PROCESS

1. Approve
2. Reject

Enter choice:

If the reviewer selects Approve:

Execute publish_to_azure()
Display the Phase 5a deployment guidance

If the reviewer selects Reject:

Execute fix_issues()
Display the Phase 5b remediation checklist

Do not only describe the approval process. Generate the actual Python implementation.
```

---

## Phase 5a — Approved: Publish to Azure Foundry

If the agent passes approval, output deployment guidance:

```
## Publish to Azure Foundry — Deploy to Production

Steps:
1. Confirm governance_status = "Approved" in the Tavro portal for agent <agent_id>
2. Package the agent:
   - Ensure all dependencies are in requirements.txt
   - Set environment variables: ANTHROPIC_API_KEY, any tool-specific secrets
3. Deploy to Azure AI Foundry:
   - Create or select an Azure AI project
   - Upload generated_agents/<filename>.py as the agent entrypoint
   - Configure the agent runtime with the required environment variables
4. Run a smoke test against the deployed endpoint using the main() scenario
5. Monitor the agent using Azure AI Foundry observability tools
```

---

## Phase 5b — Not Approved: Fix the Issue

If the agent does not pass approval, output a targeted fix list based on what failed:

```
## Fix the Issue

Issues to resolve before re-submitting:
- [ ] <specific issue derived from the approval checklist failures>
- [ ] Update governance_status in the Tavro portal once fixes are complete
- [ ] Re-run the Test in Playground checklist (Phase 3)
- [ ] Re-submit for approval

  ✓ Fixed & Approved → Proceed to Phase 5a (Publish to Azure Foundry)
  ✗ Rejected         → End Process — document rejection reason in Tavro portal
```

---

## Phase 6 — Confirm

Report back:
- File path written
- Agent name and Tavro agent_id
- AI Use Case linked (name + identifier, or "none")
- Tenant ID (or "not available")
- Tools included (names)
- Skills / knowledge sources included
- Data sources (names + PII/PHI/PCI flags)
- Business processes referenced
- Risk classification and guardrails applied
- Governance status
- Any fields missing or unresolved
