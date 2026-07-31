"""
Ransomware Threat Detection Agent
==================================
Tavro ID       : 5fd4bdc0-69a0-4b53-beb2-690cbdf2fa1e
File           : 5fd4bdc0_69a0_4b53_beb2_690cbdf2fa1e_ransomware_threat_detection_agent.py

Description    : An AI agent that continuously monitors network telemetry and endpoint activity
                 logs across EHR and clinical operations infrastructure, applying unsupervised
                 anomaly detection to identify ransomware precursor behaviors such as lateral
                 movement, unusual encryption activity, and credential harvesting. Produces
                 real-time severity-scored alerts with recommended containment actions for the
                 SOC team.

Risk           : Classification=Unknown | Score=8.76 | EU AI Act=High Risk | AIVSS=9.20
Governance     : Not set

Tools          :
  - monitor_network_telemetry
  - detect_ransomware_precursors
  - route_soc_alert

Data Sources   :
  - Ransomware Threat Detection Agent

PII: No | PHI: No | PCI: No
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
class NetworkTelemetryRecord:
    """Represents a single network telemetry event from clinical/EHR infrastructure."""
    record_id: str
    timestamp: str
    source_ip: str
    destination_ip: str
    source_port: int
    destination_port: int
    protocol: str                      # e.g., TCP, UDP, SMB, RDP
    bytes_sent: int
    bytes_received: int
    connection_duration_ms: int
    flow_direction: str                # inbound / outbound / lateral
    vlan_id: Optional[str]
    device_hostname: str
    device_type: str                   # workstation, server, medical-device, ehr-node
    geo_location: Optional[str]
    threat_intel_flag: bool            # flagged by external threat intel feed
    anomaly_score: float               # 0.0 – 1.0 from baseline model
    tags: List[str] = field(default_factory=list)


@dataclass
class EndpointActivityLog:
    """Represents endpoint activity observed on clinical workstations or servers."""
    log_id: str
    timestamp: str
    hostname: str
    username: str                      # local/domain account identifier (non-PII in aggregate context)
    process_name: str
    process_path: str
    parent_process: str
    command_line_args: str
    file_path_accessed: Optional[str]
    registry_key_accessed: Optional[str]
    network_connection_attempted: bool
    privilege_level: str               # standard, elevated, SYSTEM
    authentication_event: Optional[str]  # login, failed_login, token_manipulation
    encryption_api_calls: int          # count of CryptoAPI / BCrypt calls
    lateral_movement_indicator: bool
    credential_dump_indicator: bool
    entropy_score: float               # file write entropy (high = possible encryption)
    anomaly_score: float
    tags: List[str] = field(default_factory=list)


@dataclass
class RansomwarePrecursorAlert:
    """Structured alert produced by the detection engine."""
    alert_id: str
    timestamp: str
    severity: str                      # CRITICAL, HIGH, MEDIUM, LOW, INFO
    severity_score: float              # 0.0 – 10.0
    threat_category: str               # lateral_movement, encryption_staging, credential_harvesting, recon
    affected_assets: List[str]
    behavioral_indicators: List[str]
    confidence: float                  # 0.0 – 1.0
    recommended_playbook: str
    containment_actions: List[str]
    analyst_notes: Optional[str]
    false_positive_probability: float
    routed_to_soc: bool = False
    soc_ticket_id: Optional[str] = None


@dataclass
class SOCAlertRouting:
    """Tracks the routing and acknowledgment of alerts sent to the SOC."""
    routing_id: str
    alert_id: str
    timestamp_routed: str
    channel: str                       # SIEM, PagerDuty, Slack, email
    priority_queue: str                # P1, P2, P3
    assigned_analyst: Optional[str]
    escalation_path: List[str]
    acknowledged: bool = False
    acknowledgment_timestamp: Optional[str] = None
    resolution_status: str = "open"    # open, in_progress, resolved, false_positive


# ---------------------------------------------------------------------------
# Tool Stubs
# ---------------------------------------------------------------------------

def monitor_network_telemetry(
    time_window_seconds: int = 300,
    device_filters: Optional[List[str]] = None,
    anomaly_threshold: float = 0.65,
    include_lateral_movement: bool = True,
) -> List[dict]:
    """
    Pulls real-time network telemetry from EHR and clinical operations infrastructure.

    Connects to the network monitoring pipeline (e.g., Zeek/Suricata feeds, NetFlow
    collectors, SIEM streaming API) and returns enriched flow records filtered by the
    specified anomaly threshold and device scope.

    Args:
        time_window_seconds: Lookback window for telemetry retrieval.
        device_filters: Optional list of hostnames or IP ranges to scope the query.
        anomaly_threshold: Minimum anomaly score (0.0–1.0) for records to be returned.
        include_lateral_movement: Whether to include east-west / lateral flows.

    Returns:
        List of serialised NetworkTelemetryRecord dicts.
    """
    # TODO: Replace with real integration
    return []


def detect_ransomware_precursors(
    telemetry_records: List[dict],
    endpoint_logs: List[dict],
    sensitivity_level: str = "high",
    baseline_window_hours: int = 168,
    model_version: str = "latest",
) -> List[dict]:
    """
    Applies unsupervised anomaly detection models to identify ransomware precursor
    behaviors from correlated telemetry and endpoint log data.

    Runs isolation forest, autoencoder, and UEBA rule-based checks against adaptive
    baselines. Scores behavioral deviations against known ransomware kill-chain stages
    (reconnaissance, credential access, lateral movement, collection, encryption staging).

    Args:
        telemetry_records: Network flow records from monitor_network_telemetry.
        endpoint_logs: Endpoint activity logs to correlate with network data.
        sensitivity_level: Detector sensitivity — 'low', 'medium', 'high', 'critical'.
        baseline_window_hours: Rolling baseline window for anomaly scoring.
        model_version: Version tag of the deployed detection model.

    Returns:
        List of serialised RansomwarePrecursorAlert dicts ordered by severity_score desc.
    """
    # TODO: Replace with real integration
    return []


def route_soc_alert(
    alert: dict,
    priority_override: Optional[str] = None,
    notify_channels: Optional[List[str]] = None,
    attach_playbook: bool = True,
    auto_isolate_threshold: float = 9.5,
) -> dict:
    """
    Routes a severity-scored ransomware precursor alert to the SOC via configured
    notification channels and optionally triggers automated containment.

    Integrates with the SIEM ticketing system, PagerDuty escalation, and (when the
    severity score exceeds auto_isolate_threshold) calls the endpoint isolation API
    to quarantine the affected asset pending analyst review.

    Args:
        alert: Serialised RansomwarePrecursorAlert dict.
        priority_override: Optional manual priority (P1/P2/P3) to override auto-assignment.
        notify_channels: List of channels to notify (SIEM, PagerDuty, Slack, email).
        attach_playbook: Whether to attach the recommended SOC containment playbook.
        auto_isolate_threshold: Severity score above which automatic isolation fires.

    Returns:
        Serialised SOCAlertRouting dict with ticket ID and acknowledgment status.
    """
    # TODO: Replace with real integration
    return {}


# ---------------------------------------------------------------------------
# Claude Tool Definitions
# ---------------------------------------------------------------------------

TOOLS: List[dict] = [
    {
        "name": "monitor_network_telemetry",
        "description": (
            "Pulls real-time network telemetry and endpoint flow data from EHR and clinical "
            "operations infrastructure. Returns enriched network flow records filtered by "
            "anomaly score threshold, time window, and optional device scope. Use this tool "
            "first to gather current telemetry before running detection. Supports lateral "
            "movement flag filtering for east-west traffic analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "time_window_seconds": {
                    "type": "integer",
                    "description": "Lookback window in seconds for telemetry retrieval. Default 300.",
                    "default": 300,
                },
                "device_filters": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of hostnames or CIDR ranges to scope the query.",
                },
                "anomaly_threshold": {
                    "type": "number",
                    "description": "Minimum anomaly score (0.0–1.0) for records to be returned. Default 0.65.",
                    "default": 0.65,
                },
                "include_lateral_movement": {
                    "type": "boolean",
                    "description": "Whether to include east-west lateral movement flows. Default true.",
                    "default": True,
                },
            },
            "required": [],
        },
    },
    {
        "name": "detect_ransomware_precursors",
        "description": (
            "Applies unsupervised anomaly detection and UEBA rule-based checks against "
            "correlated network telemetry and endpoint activity logs to identify ransomware "
            "precursor behaviors. Returns severity-scored alerts with threat category, "
            "affected assets, behavioral indicators, confidence scores, and recommended "
            "SOC containment playbooks. Models cover: reconnaissance, credential harvesting, "
            "lateral movement, encryption staging, and data exfiltration precursors."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "telemetry_records": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Network flow records from monitor_network_telemetry.",
                },
                "endpoint_logs": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Endpoint activity log records to correlate with network data.",
                },
                "sensitivity_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": "Detector sensitivity level controlling false-positive/negative trade-off.",
                    "default": "high",
                },
                "baseline_window_hours": {
                    "type": "integer",
                    "description": "Rolling baseline window in hours for adaptive anomaly scoring. Default 168.",
                    "default": 168,
                },
                "model_version": {
                    "type": "string",
                    "description": "Version tag of the deployed detection model. Default 'latest'.",
                    "default": "latest",
                },
            },
            "required": ["telemetry_records", "endpoint_logs"],
        },
    },
    {
        "name": "route_soc_alert",
        "description": (
            "Routes a severity-scored ransomware precursor alert to the SOC via configured "
            "notification channels (SIEM, PagerDuty, Slack, email). Attaches recommended "
            "containment playbooks and, when the severity score exceeds the auto-isolation "
            "threshold, triggers automated endpoint quarantine pending analyst review. "
            "Returns a routing record with ticket ID and acknowledgment status. Use this "
            "tool for all HIGH and CRITICAL severity alerts immediately."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "alert": {
                    "type": "object",
                    "description": "Serialised RansomwarePrecursorAlert dict to route.",
                },
                "priority_override": {
                    "type": "string",
                    "enum": ["P1", "P2", "P3"],
                    "description": "Optional manual priority override.",
                },
                "notify_channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Channels to notify: SIEM, PagerDuty, Slack, email.",
                },
                "attach_playbook": {
                    "type": "boolean",
                    "description": "Whether to attach the recommended SOC containment playbook. Default true.",
                    "default": True,
                },
                "auto_isolate_threshold": {
                    "type": "number",
                    "description": "Severity score above which automatic isolation fires. Default 9.5.",
                    "default": 9.5,
                },
            },
            "required": ["alert"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool Dispatcher
# ---------------------------------------------------------------------------

def handle_tool_call(name: str, inputs: dict) -> Any:
    """
    Dispatches a tool call by name to the corresponding stub function and returns
    the result as a JSON-serialisable object.

    Args:
        name: The tool name as declared in TOOLS.
        inputs: The validated input dictionary from Claude's tool_use block.

    Returns:
        Tool result as a dict or list.
    """
    if name == "monitor_network_telemetry":
        return monitor_network_telemetry(
            time_window_seconds=inputs.get("time_window_seconds", 300),
            device_filters=inputs.get("device_filters"),
            anomaly_threshold=inputs.get("anomaly_threshold", 0.65),
            include_lateral_movement=inputs.get("include_lateral_movement", True),
        )
    elif name == "detect_ransomware_precursors":
        return detect_ransomware_precursors(
            telemetry_records=inputs.get("telemetry_records", []),
            endpoint_logs=inputs.get("endpoint_logs", []),
            sensitivity_level=inputs.get("sensitivity_level", "high"),
            baseline_window_hours=inputs.get("baseline_window_hours", 168),
            model_version=inputs.get("model_version", "latest"),
        )
    elif name == "route_soc_alert":
        return route_soc_alert(
            alert=inputs.get("alert", {}),
            priority_override=inputs.get("priority_override"),
            notify_channels=inputs.get("notify_channels"),
            attach_playbook=inputs.get("attach_playbook", True),
            auto_isolate_threshold=inputs.get("auto_isolate_threshold", 9.5),
        )
    else:
        return {"error": f"Unknown tool: {name}"}


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
=== GOVERNANCE WARNING ===
This agent's governance status is: NOT SET.
Governance approval has NOT been obtained for this agent. It must NOT be deployed
to production environments until formal review and approval are completed in
accordance with Tavro platform policies and applicable regulatory requirements.
All outputs must be treated as provisional until governance is resolved.
Risk Score: 8.76 / 10.00 | EU AI Act Classification: HIGH RISK | AIVSS: 9.20
==========================

## Identity & Role
You are a cybersecurity threat detection specialist AI deployed on the Tavro Agent BizOps
platform (Tavro ID: 5fd4bdc0-69a0-4b53-beb2-690cbdf2fa1e). Your designation is the
Ransomware Threat Detection Agent. You operate within a clinical and healthcare IT
environment protecting EHR systems, medical devices, and operational infrastructure
against ransomware and related advanced persistent threats.

## Business Context
Healthcare organisations face an elevated and escalating ransomware threat landscape.
Successful attacks against EHR and clinical operations infrastructure cause patient
safety risks, regulatory penalties under HIPAA, and severe operational disruption.
Early detection of ransomware precursor behaviors — before encryption payloads execute —
is the primary defence mechanism. Your role is to provide the SOC team with actionable,
severity-scored intelligence that enables rapid containment and minimises patient impact.

## Operational Instructions
Monitor network telemetry and endpoint logs in real time across all connected clinical
and EHR infrastructure nodes. Apply unsupervised anomaly detection to identify behavioral
deviations consistent with the following ransomware kill-chain stages:

  1. RECONNAISSANCE — unusual port scanning, DNS enumeration, network mapping activity
  2. CREDENTIAL HARVESTING — LSASS memory access, Kerberoasting indicators, pass-the-hash
     patterns, unusual authentication failures, token manipulation events
  3. LATERAL MOVEMENT — SMB relay, RDP brute-force, PsExec-style remote execution,
     anomalous east-west traffic patterns between clinical workstations and servers
  4. ENCRYPTION STAGING — high-entropy file writes, mass file rename/deletion patterns,
     volume shadow copy deletion, high CryptoAPI/BCrypt call rates from unusual processes
  5. EXFILTRATION PRECURSORS — large outbound data transfers to unknown external IPs,
     archive creation from sensitive directories, unusual cloud storage API calls

For each detected behavioral cluster:
  - Assign a severity score (0.0–10.0) using multi-factor weighting: asset criticality,
    confidence, kill-chain stage, blast radius estimate
  - Classify severity tier: CRITICAL (≥9.0), HIGH (7.0–8.9), MEDIUM (4.0–6.9),
    LOW (1.0–3.9), INFO (<1.0)
  - Attach a recommended SOC containment playbook appropriate to the threat category
  - List specific containment actions ordered by urgency
  - Route HIGH and CRITICAL alerts immediately via route_soc_alert with P1/P2 priority
  - Minimise false positives through adaptive baseline tuning — do not alert on
    scheduled maintenance windows, known patch deployment patterns, or approved
    backup jobs unless combined with other indicators

Always follow the monitoring workflow in order:
  1. Call monitor_network_telemetry to gather current telemetry
  2. Call detect_ransomware_precursors with the telemetry and any available endpoint logs
  3. For each HIGH or CRITICAL alert produced, call route_soc_alert immediately
  4. Summarise findings, actions taken, and recommended analyst follow-up

## Data Sensitivity Guardrails
Data sensitivity classification for this agent: PII=No | PHI=No | PCI=No

Although this agent does not directly process PHI, it operates within a HIPAA-regulated
environment where PHI may be present in adjacent systems. Apply the following guardrails:

  - Do NOT log, store, or transmit patient identifiers, medical record numbers,
    diagnosis codes, or any PHI encountered incidentally in log data
  - Redact or mask any PHI fields before including data in alert payloads routed
    outside the secure monitoring environment
  - All monitoring activity must comply with the HIPAA Security Rule (45 CFR Part 164)
    requirements for audit controls, integrity controls, and transmission security
  - Maintain audit logs of all detection and routing actions for HIPAA compliance
    reporting (minimum 6-year retention)
  - Apply minimum-necessary principle: only access data required for threat detection

## Risk-Aware Guardrails
This agent carries a HIGH risk classification (Score: 8.76, AIVSS: 9.20, EU AI Act: High Risk).
The following risk controls are mandatory:

  - HUMAN OVERSIGHT REQUIRED: All CRITICAL severity alerts must be reviewed by a
    qualified SOC analyst before automated containment actions take effect, except
    where the severity score exceeds 9.5 AND the affected asset is non-critical
    infrastructure. Document analyst review for compliance purposes.
  - DO NOT autonomously shut down, isolate, or modify clinical systems supporting
    active patient care (ventilators, infusion pumps, patient monitoring devices)
    without explicit SOC analyst authorisation
  - Maintain a confidence threshold of ≥0.70 before escalating to CRITICAL severity
  - When uncertainty is high (confidence < 0.50), classify as MEDIUM maximum and
    flag for analyst review with full indicator context
  - Log all automated decisions with rationale for post-incident audit review
  - Alert on any detection model degradation (anomaly score distribution drift,
    unusual alert volume spikes) as this may indicate model evasion attempts
  - EU AI Act compliance: maintain full traceability of detection logic, model
    version, input data sources, and output decisions for regulatory audit
"""


# ---------------------------------------------------------------------------
# Agentic Loop
# ---------------------------------------------------------------------------

def run_agent(user_message: str) -> str:
    """
    Runs the Ransomware Threat Detection Agent agentic loop.

    Sends the user message to Claude claude-sonnet-4-6 with the defined tools and system prompt,
    processes tool calls iteratively until the model produces a final text response,
    and returns that response as a string.

    Args:
        user_message: The task or query to execute.

    Returns:
        The final text response from the agent.
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages = [{"role": "user", "content": user_message}]

    print(f"\n[Agent] Starting Ransomware Threat Detection Agent")
    print(f"[Agent] Task: {user_message}\n")

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

        # Check stop reason
        if response.stop_reason == "end_turn":
            # Extract final text response
            for block in response.content:
                if hasattr(block, "text"):
                    print(f"[Agent] Final response received.\n")
                    return block.text
            return "[Agent] No text response produced."

        elif response.stop_reason == "tool_use":
            # Process all tool use blocks
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    tool_name = block.name
                    tool_inputs = block.input
                    tool_use_id = block.id

                    print(f"[Tool] Calling: {tool_name}")
                    print(f"[Tool] Inputs: {json.dumps(tool_inputs, indent=2)}")

                    result = handle_tool_call(tool_name, tool_inputs)

                    print(f"[Tool] Result: {json.dumps(result, indent=2)}\n")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps(result),
                    })

            # Append tool results to conversation
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop reason — surface it
            print(f"[Agent] Unexpected stop reason: {response.stop_reason}")
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return f"[Agent] Stopped with reason: {response.stop_reason}"


# ---------------------------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------------------------

def main():
    """
    Realistic invocation: trigger a full monitoring cycle across the EHR and clinical
    operations network, detect any ransomware precursor activity in the current 5-minute
    window, score and categorise findings, and route any HIGH/CRITICAL alerts to the SOC
    with recommended containment playbooks.
    """
    task = (
        "Perform a full ransomware precursor detection cycle for the clinical network environment. "
        "Retrieve the latest 5-minute network telemetry window from all EHR nodes, clinical "
        "workstations, and medical device segments with an anomaly threshold of 0.65. "
        "Include lateral movement flows. Correlate with available endpoint activity logs. "
        "Run the detection engine at HIGH sensitivity using the latest model version and a "
        "7-day rolling baseline. For any alerts produced: score by severity, attach appropriate "
        "SOC containment playbooks, and immediately route all HIGH and CRITICAL severity findings "
        "via PagerDuty and SIEM channels. Provide a concise executive summary of findings, "
        "actions taken, active threat indicators, and recommended analyst follow-up steps."
    )

    result = run_agent(task)
    print("=" * 80)
    print("RANSOMWARE THREAT DETECTION AGENT — CYCLE REPORT")
    print("=" * 80)
    print(result)
    print("=" * 80)


# ---------------------------------------------------------------------------
# Approval Workflow & Azure Publishing
# ---------------------------------------------------------------------------

def approval_workflow():
    """
    Manages the governance approval workflow for the Ransomware Threat Detection Agent.

    Checks current governance status, validates risk score thresholds, and gates
    production deployment pending formal review. For HIGH RISK (EU AI Act) agents,
    enforces mandatory human review steps before clearance.
    """
    governance_status = "Not set"
    risk_score = 8.76
    eu_ai_act_classification = "High Risk"
    aivss_score = 9.20

    print("\n[Approval Workflow] Initiating governance review...")
    print(f"  Agent          : Ransomware Threat Detection Agent")
    print(f"  Tavro ID       : 5fd4bdc0-69a0-4b53-beb2-690cbdf2fa1e")
    print(f"  Governance     : {governance_status}")
    print(f"  Risk Score     : {risk_score} / 10.00")
    print(f"  EU AI Act      : {eu_ai_act_classification}")
    print(f"  AIVSS          : {aivss_score}")

    issues = []

    if governance_status != "Approved":
        issues.append(
            f"Governance status is '{governance_status}' — formal approval required before "
            "production deployment."
        )

    if risk_score >= 8.0:
        issues.append(
            f"Risk score {risk_score} exceeds high-risk threshold (8.0). Enhanced review "
            "by CISO and Data Protection Officer required."
        )

    if eu_ai_act_classification == "High Risk":
        issues.append(
            "EU AI Act High Risk classification requires conformity assessment, technical "
            "documentation, and registration in the EU AI Act database before deployment."
        )

    if aivss_score >= 9.0:
        issues.append(
            f"AIVSS score {aivss_score} indicates critical AI vulnerability surface. "
            "Security red-team assessment required before production release."
        )

    if issues:
        print("\n[Approval Workflow] BLOCKED — Issues requiring resolution:")
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {issue}")
        print("\n[Approval Workflow] Status: PENDING APPROVAL")
        print("[Approval Workflow] Action: Calling fix_issues() to address blockers...\n")
        fix_issues(issues)
    else:
        print("\n[Approval Workflow] All checks passed. Proceeding to publish...")
        publish_to_azure()


def publish_to_azure():
    """
    Publishes the approved Ransomware Threat Detection Agent to the Azure-hosted
    Tavro BizOps production environment.

    Packages the agent artefact, validates environment configuration, and deploys
    to the target Azure subscription with appropriate RBAC and Key Vault bindings.
    """
    print("\n[Azure Publish] Initiating deployment to Azure production environment...")

    deployment_config = {
        "tavro_id": "5fd4bdc0-69a0-4b53-beb2-690cbdf2fa1e",
        "agent_name": "Ransomware Threat Detection Agent",
        "azure_subscription": os.environ.get("AZURE_SUBSCRIPTION_ID", "<not-configured>"),
        "resource_group": os.environ.get("AZURE_RESOURCE_GROUP", "<not-configured>"),
        "azure_region": os.environ.get("AZURE_REGION", "eastus"),
        "key_vault": os.environ.get("AZURE_KEY_VAULT_NAME", "<not-configured>"),
        "model": "claude-sonnet-4-5",
        "max_tokens": 4096,
        "log_analytics_workspace": os.environ.get("AZURE_LOG_ANALYTICS_WS", "<not-configured>"),
        "hipaa_compliance_mode": True,
        "audit_retention_days": 2190,  # 6 years per HIPAA requirement
    }

    print(f"  Deployment Config:")
    for key, value in deployment_config.items():
        print(f"    {key}: {value}")

    # TODO: Replace with real Azure SDK deployment logic
    # from azure.identity import DefaultAzureCredential
    # from azure.mgmt.containerinstance import ContainerInstanceManagementClient
    # credential = DefaultAzureCredential()
    # client = ContainerInstanceManagementClient(credential, deployment_config["azure_subscription"])
    # ... deploy container / function app / AKS workload

    print("\n[Azure Publish] Deployment package prepared.")
    print("[Azure Publish] HIPAA compliance mode: ENABLED")
    print("[Azure Publish] Audit logging to Log Analytics: CONFIGURED")
    print("[Azure Publish] Status: READY — awaiting governance approval to execute deploy.\n")


def fix_issues(issues: List[str]):
    """
    Provides structured remediation guidance for each governance or risk issue
    blocking deployment approval.

    Args:
        issues: List of issue descriptions returned by the approval_workflow check.
    """
    print("[Fix Issues] Generating remediation plan for identified blockers:\n")

    remediation_map = {
        "Governance status is": (
            "ACTION: Submit the agent for formal governance review via the Tavro platform "
            "approval portal. Assign a Data Owner, complete the AI use-case registration "
            "form, and obtain sign-off from the CISO and Compliance Officer. "
            "ETA: 5–10 business days."
        ),
        "Risk score": (
            "ACTION: Schedule enhanced risk review with CISO and DPO. Document risk "
            "mitigation controls (human oversight requirements, auto-isolation thresholds, "
            "model monitoring). Update risk register with accepted residual risk and "
            "compensating controls. ETA: 3–5 business days."
        ),
        "EU AI Act High Risk": (
            "ACTION: Complete EU AI Act conformity assessment. Prepare technical "
            "documentation per Annex IV requirements. Implement conformity management "
            "system. Register system in EU AI Act database via responsible person. "
            "Engage external auditor for third-party conformity review. ETA: 4–8 weeks."
        ),
        "AIVSS score": (
            "ACTION: Engage AI security red-team to assess adversarial robustness, "
            "model evasion vectors, prompt injection risks, and supply chain integrity. "
            "Implement recommended hardening measures. Re-score post-remediation. "
            "ETA: 2–4 weeks."
        ),
    }

    for issue in issues:
        matched = False
        for key, remediation in remediation_map.items():
            if key.lower() in issue.lower():
                print(f"  Issue    : {issue}")
                print(f"  Remedy   : {remediation}\n")
                matched = True
                break
        if not matched:
            print(f"  Issue    : {issue}")
            print(
                "  Remedy   : Escalate to Tavro platform administrator for manual review "
                "and remediation guidance.\n"
            )

    print("[Fix Issues] Remediation plan complete. Re-run approval_workflow() after addressing all items.")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
    approval_workflow()