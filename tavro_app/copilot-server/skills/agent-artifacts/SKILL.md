---
name: agent-artifacts
description: Automatically generate Requirements and Technical Design artifacts as PDFs immediately after every successful agent creation
---

# Agent Artifact Generation

After every successful `create_agent` tool call you MUST automatically generate two governance artifacts for the newly created agent — a Requirements Document and a Technical Design Document — without waiting for the user to ask. Execute this workflow immediately after confirming the creation.

---

## Post-Creation Artifact Workflow

1. Confirm the agent creation with name and ID in one brief sentence.
2. Output the **Requirements Document** in full PDF-ready format (Document 1).
3. Output the **Technical Design Document** in full PDF-ready format (Document 2).

The Tavro platform reads the heading of each document to derive its PDF filename and attaches both files to the agent record automatically:
- Document starting with `# {Agent Name} Requirement` → `{Agent Name} Requirement.pdf`
- Document starting with `# {Agent Name} Technical` → `{Agent Name} Technical.pdf`

where `{Agent Name}` is the **exact name** of the agent that was just created.

---

## General Rules for Both Documents

- **Derive content** from the agent's `agent_name`, `description`, `instruction`, `tools`, `knowledge_source`, and `data_sources` supplied in the `create_agent` call.
- **If a Company Blueprint is present**, ground every section in it: use `[strategy]` for objectives and value, `[risk]` and `[process]` for constraints and problem statements, `[technology]` and `[integration]` for architecture and tools. Never override `[industry]` or `[region]` values.
- **Do NOT invent** technical specifics, integration names, or agent names not present in the agent metadata or blueprint.
- **Format**: clean markdown — `##` for sections, `**bold**` for key terms, `-` for bullets, `| table |` for tabular data.
- **ASCII only** — no emojis, no Unicode symbols.
- **No preamble, no closing remarks.** Each document starts directly with its `# Title` heading.

---

## Document 1: Requirements Document

Begin the document with exactly:

```
# {Agent Name} Requirement
```

Then output the following sections in order:

### Summary

A concise 2-3 sentence overview of the agent's purpose, the business function it serves, and the value it delivers.

### Business Context

The organizational or industry context in which the agent operates. Reference Company Blueprint `[industry]`, `[region]`, and `[strategy]` dimensions when available.

### Problem Statement

The specific business problem or opportunity the agent addresses. Derive from the agent's description and blueprint `[risk]` / `[process]` dimensions.

### Objectives

A bulleted list of measurable goals the agent is designed to achieve.

### Functional Requirements

A numbered list of core functional capabilities the agent must support. Derive from the agent's `instruction`, `tools`, and `knowledge_source`.

### Non-Functional Requirements

Quality attributes and operational constraints the agent must satisfy:
- Performance and latency expectations
- Scalability and concurrency requirements
- Reliability and availability targets
- Maintainability and observability needs

### Data Requirements

Data inputs, outputs, and sensitivity classifications. Reference any `data_sources` or `tools` provided in the agent definition. Identify any PII, PHI, or PCI data handled.

### Constraints and Assumptions

Known technical, business, or regulatory constraints that bound the solution. List assumptions made where explicit information is absent.

### Acceptance Criteria

Testable conditions that must be met before the agent is considered deployment-ready. Write each criterion in the format: "Given [context], when [action], then [expected outcome]."

<!-- ### Checklist

Governance readiness items:

- [ ] Risk assessment completed and approved
- [ ] Data privacy and protection review completed
- [ ] Security controls validated
- [ ] AI use case linked and documented
- [ ] Stakeholder approval obtained
- [ ] End-user training material prepared
- [ ] Monitoring and alerting configured
- [ ] Incident response runbook in place
- [ ] Deployment rollback plan defined
- [ ] AI risk governance review done (per blueprint review templates)
- [ ] End user computing review completed
- [ ] Operations review completed -->

---

## Document 2: Technical Design Document

Begin the document with exactly:

```
# {Agent Name} Technical
```

Then output the following sections in order:

### Platform Considerations

Describe the hosting environment, AI platform, and deployment constraints. If a Company Blueprint is present, derive platform choices from the `[technology]` and `[integration]` dimensions. Address model provider, runtime environment, and any cloud or on-premises requirements.

### Architecture

A high-level description of the agent's architecture: inputs, processing logic, decision flow, and outputs. Explain how this agent fits within the broader AI ecosystem and any upstream or downstream dependencies.

### Components

A table listing the agent's key components:

| Component | Type | Description |
|-----------|------|-------------|
| {Agent Name} | Agent | Core agent performing the primary task |

Extend the table with rows for each tool, knowledge source, data source, and MCP server defined in the agent. If none were specified, note that integrations are to be defined in the implementation phase.

### Tools and Integrations

For each tool or integration defined for the agent, describe:
- **Name**: tool or integration name
- **Purpose**: what it does in the context of this agent
- **Integration approach**: how it connects (API, MCP, SDK, etc.)
- **Data exchanged**: inputs passed to it and outputs received

If no tools were specified, state that tool definitions are deferred to the implementation phase.

### Security and Compliance

- Authentication and authorization controls for the agent
- Data classification of inputs and outputs
- Applicable regulatory frameworks (reference blueprint `[risk]` dimension)
- Secrets and credential management approach
- Audit logging requirements
- Any end user computing or AI risk governance controls required

### Implementation Considerations

Key engineering decisions, known risks, and mitigation strategies, including:
- Model selection rationale
- Context window and token management
- Prompt injection and hallucination mitigation
- Error handling and graceful degradation
- Version pinning and reproducibility

### Deployment and Operations

- **Target environment**: where the agent will be deployed (cloud region, container, platform)
- **Rollout strategy**: phased, canary, or full deployment
- **Monitoring**: key metrics to observe (latency, error rate, token usage, accuracy)
- **Alerting thresholds**: conditions that trigger on-call or escalation
- **Incident response**: steps to take when the agent produces unexpected outputs
- **Scaling**: horizontal or vertical scaling triggers

### Implementation Plan Draft

A phased deployment plan for the agent:

**Phase 1 — Design and Validation**
- Finalize requirements document and obtain stakeholder sign-off
- Complete risk assessment and AI risk governance review
- Validate blueprint alignment

**Phase 2 — Development and Testing**
- Implement agent with defined tools and instructions
- Unit and integration testing of all tool calls
- Security review and penetration testing

**Phase 3 — Pilot Deployment**
- Limited rollout to a defined subset of users or processes
- Collect feedback and measure acceptance criteria
- Resolve defects and tune agent behavior

**Phase 4 — Production Deployment**
- Full rollout with monitoring and alerting active
- User onboarding and training completed
- Handover to operations team

**Phase 5 — Post-Deployment Review**
- Performance evaluation against objectives
- Lessons learned documentation
- Optimization backlog created

### Final Approved Implementation Plan

To be completed after Phase 3 pilot outcomes are reviewed. Populate with:
- Confirmed infrastructure configuration
- Approved rollout schedule with dates
- Sign-off from AI governance committee
- Production readiness checklist completion evidence
- Project plan for deployment on target implementation infrastructure and framework

---

## Naming Convention Reference

| Document | File Name |
|----------|-----------|
| Requirements Document | `{Agent Name} Requirement.pdf` |
| Technical Design Document | `{Agent Name} Technical.pdf` |

Both files are automatically attached to the agent's record in Tavro after the AI response is processed.
