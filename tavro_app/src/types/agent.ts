// ── Identification ────────────────────────────────────────────────────────────

export interface AgentIdentification {
  agent_id: string;
  role: string | null;
  instruction: string | null;
  goal_orientation?: string | null;
  environment?: string | null;
  owner?: string | null;
  tags?: string | null;
  governance_status?: string | null;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface AgentConfiguration {
  autonomy_level: string | null;
  access_scope?: string | null;
  memory_type?: string | null;
  data_freshness_policy?: string | null;
  reasoning_model?: string | null;
}

// ── Business impact ───────────────────────────────────────────────────────────

export interface ApplicationImpact {
  identifier: string | null;
  name: string | null;
  description: string | null;
  business_criticality: string | null;
  emergency_tier: string | null;
}

export interface BusinessProcessImpact {
  identifier: string;
  name: string;
  description: string | null;
  business_criticality: string;
}

// ── AI Use Case ───────────────────────────────────────────────────────────────

export interface AiUseCase {
  identifier?: string | null;
  name?: string | null;
  description?: string | null;
  proposed_by?: string | null;
  owner?: string | null;
  function?: string | null;
  problem_statement?: string | null;
  expected_benefits?: string | null;
  priority?: string | null;
  status?: string | null;
}

// ── AI Model ──────────────────────────────────────────────────────────────────

export interface AiModel {
  name?: string | null;
  owner?: string | null;
  department_executive?: string | null;
  description?: string | null;
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export interface AgentTool {
  identifier: string | null;
  name: string;
  description: string;
  delegation_possible?: string | null;
  allowed_delegates?: string | null;
  parameter_name?: string | null;
  parameter_type?: string | null;
}

// ── Data Source ───────────────────────────────────────────────────────────────

export interface AgentDataSource {
  relationship_id?: string | null;
  parent_relationship_id?: string | null;
  source_object_id: string;
  source_object_domain?: string | null;
  source_object_name: string;
  source_object_type: string;
  target_object_id: string;
  target_object_domain?: string | null;
  target_object_name: string;
  target_object_type: string;
  access_level?: string | null;
  uses_pii?: string | null;
  uses_phi?: string | null;
  uses_pci?: string | null;
}

// ── Guardrail ─────────────────────────────────────────────────────────────────

export interface Guardrail {
  name?: string | null;
  description?: string | null;
  model?: string | null;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

export interface McpServer {
  name?: string | null;
  url?: string | null;
  version_number?: string | null;
}

// ── Knowledge Source ──────────────────────────────────────────────────────────

export interface KnowledgeSource {
  identifier?: string | null;
  name?: string | null;
  access_mechanism?: string | null;
}

// ── Prompt Template ───────────────────────────────────────────────────────────

export interface PromptTemplate {
  identifier?: string | null;
  name?: string | null;
  description?: string | null;
}

// ── Memory ────────────────────────────────────────────────────────────────────

export interface AgentMemory {
  identifier?: string | null;
  name?: string | null;
  type?: string | null;
}

// ── Regulation / Framework ────────────────────────────────────────────────────

export interface RegulationOrFramework {
  name?: string | null;
  type?: string | null;
  regulatory_authority?: string | null;
  jurisdiction?: string | null;
  requirement?: string | null;
}

// ── Control ───────────────────────────────────────────────────────────────────

export interface AgentControl {
  identifier?: string | null;
  name?: string | null;
  objective?: string | null;
  domain?: string | null;
}

// ── Skill ─────────────────────────────────────────────────────────────────────

export interface AgentSkill {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
}

export interface AgentIssue {
  identifier: string;
  title: string;
  description?: string | null;
  issue_type?: string | null;
  severity?: string | null;
  source?: string | null;
  detected_at?: string | null;
  resolved_at?: string | null;
  status?: string | null;
  resolution_notes?: string | null;
  assignee?: string | null;
  owner?: string | null;
  created_ts?: string | null;
  updated_ts?: string | null;
}

// ── Instruction Set ───────────────────────────────────────────────────────────

export interface InstructionSet {
  id?: string | null;
  name?: string | null;
  instruction?: string | null;
}

// ── Security ──────────────────────────────────────────────────────────────────

export interface SecurityScheme {
  type?: string | null;
  description?: string | null;
  [key: string]: any;
}

// ── Risk Assessment ───────────────────────────────────────────────────────────

export interface RiskAssessment {
  identifier?: string | null;
  name?: string | null;
  assessor?: string | null;
  date?: string | null;
  blended_risk_score?: string | null;
  /** Primary risk level: "High" | "Medium" | "Low" | "Critical" */
  blended_risk_classification?: string | null;
  aivss_score?: string | null;
  aivss_classification?: string | null;
  regulatory_risk_score?: string | null;
  regulatory_risk_classification?: string | null;
  state?: string | null;
}

// ── Agent Capabilities ────────────────────────────────────────────────────────

export interface AgentCapabilities {
  streaming?: boolean | null;
  [key: string]: any;
}

// ── Root AgentData ────────────────────────────────────────────────────────────

export interface AgentData {
  // Identity
  name: string;
  description: string;
  version: string;
  url?: string | null;
  documentation_url?: string | null;
  icon_url?: string | null;
  protocol_version?: string | null;
  preferredTransport?: string | null;
  defaultInputModes?: string[] | null;
  defaultOutputModes?: string[] | null;
  supports_authenticated_extended_card?: boolean | null;

  // Provider
  provider?: { organization: string; url: string };

  // Capabilities
  capabilities?: AgentCapabilities | null;

  // Identity & config
  identification: AgentIdentification;
  configuration: AgentConfiguration;

  // Use case
  ai_use_case?: AiUseCase | null;
  ai_use_cases?: AiUseCase[] | null;

  // Models
  ai_model?: AiModel[] | null;

  // Functional
  tool: AgentTool[];
  data_source: AgentDataSource[];
  knowledge_source?: KnowledgeSource | null;
  prompt_template?: PromptTemplate | null;
  memory?: AgentMemory | null;
  guardrail?: Guardrail | null;
  mcp_server?: McpServer | null;

  // Skills & instructions
  skills?: AgentSkill[] | null;
  issues?: AgentIssue[] | null;
  instruction_sets?: InstructionSet[] | null;

  // Business
  application: ApplicationImpact[];
  business_process: BusinessProcessImpact[];

  // Risk & compliance
  regulation_or_framework?: RegulationOrFramework | null;
  control?: AgentControl[] | null;
  risk_assessment?: RiskAssessment | null;

  // Security
  security?: any | null;
  security_schemes?: Record<string, SecurityScheme> | null;

  // Metadata
  sys_id?: string;
  id?: string;
  latest_risk_score?: string | number | null;
  latest_risk_class?: string | null;
  latest_event_status?: string | null;
}
