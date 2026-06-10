export interface RelatedAgentReference {
  agent_id: string | null;
  agent_internal_id: string | null;
  agent_name: string | null;
}

export interface RelatedProcessReference {
  business_process_id: string;
  process_name: string | null;
  relationship_type: string | null;
}

export interface RelatedUseCaseReference {
  identifier: string;
  name: string | null;
  description: string | null;
  owner: string | null;
  priority: string | null;
  status: string | null;
}

export interface BusinessApplicationRecord {
  tenant_id: string | null;
  business_application_id: string;
  agent_id: string | null;
  agent_internal_id: string | null;
  application_name: string | null;
  emergency_tier: string | null;
  business_owner: string | null;
  application_portfolio_manager: string | null;
  vendor_name: string | null;
  business_criticality: string | null;
  it_application_owner: string | null;
  application_description: string | null;
  agent_risk_exposure: number | null;
  num_of_associated_agents: number | null;
  inherent_risk_classification: string | null;
  residual_risk_classification: string | null;
  agent_risk_tier: string | null;
  blended_risk_score: number | null;
  inherent_risk_classification_score: number | null;
  residual_risk_classification_score: number | null;
  embedded_ai: string | null;
  opt_out_option: string | null;
  privacy_policy_url: string | null;
  data_excluded_from_ai_training: string | null;
  vendor_description: string | null;
  current_installed_version: string | null;
  is_current_version_supported: string | null;
  latest_released_version: string | null;
  latest_release_date: string | null;
  latest_release_documentation_link: string | null;
  created_ts: string | null;
  updated_ts: string | null;
  related_agents: RelatedAgentReference[];
  related_agent_count: number;
  related_use_cases: RelatedUseCaseReference[];
}

export interface BusinessProcessRecord {
  tenant_id: string | null;
  business_process_id: string;
  agent_id: string | null;
  agent_internal_id: string | null;
  process_number: string | null;
  process_name: string | null;
  process_description: string | null;
  parent_process_id: string | null;
  parent_process_name: string | null;
  owner: string | null;
  stakeholders: string | null;
  operators: string | null;
  business_criticality: string | null;
  reputational_impact: string | null;
  num_of_associated_agents: number | null;
  agent_risk_tier: string | null;
  residual_risk_classification: string | null;
  inherent_risk_classification: string | null;
  financial_impact: string | null;
  regulatory_impact: string | null;
  agent_risk_exposure: number | null;
  blended_risk_score: number | null;
  residual_risk_classification_score: number | null;
  inherent_risk_classification_score: number | null;
  sla: string | null;
  process_health_state: string | null;
  created_ts: string | null;
  updated_ts: string | null;
  related_agents: RelatedAgentReference[];
  related_agent_count: number;
  related_processes: RelatedProcessReference[];
  related_use_cases: RelatedUseCaseReference[];
}

export interface ChildAgentReference {
  agent_id: string | null;
  agent_internal_id: string | null;
  agent_name: string | null;
  agent_description: string | null;
  relationship_label: string | null;
  // 'CHILD' = the referenced agent is a child of the agent being viewed.
  // 'PARENT' = the referenced agent is a parent of the agent being viewed.
  direction?: 'CHILD' | 'PARENT' | null;
}

export interface AgentRelationsPayload {
  agent: {
    agent_id: string | null;
    agent_internal_id: string | null;
    agent_name: string | null;
    tenant_id: string | null;
  };
  applications: Array<{
    business_application_id: string;
    application_name: string | null;
    application_description: string | null;
    business_criticality: string | null;
    emergency_tier: string | null;
    business_owner: string | null;
    application_portfolio_manager: string | null;
    vendor_name: string | null;
    it_application_owner: string | null;
    inherent_risk_classification: string | null;
    residual_risk_classification: string | null;
    agent_risk_tier: string | null;
    blended_risk_score: number | null;
  }>;
  business_processes: Array<{
    business_process_id: string;
    process_name: string | null;
    process_description: string | null;
    business_criticality: string | null;
    parent_process_id: string | null;
    parent_process_name: string | null;
    owner: string | null;
    stakeholders: string | null;
    operators: string | null;
    reputational_impact: string | null;
    financial_impact: string | null;
    regulatory_impact: string | null;
    agent_risk_tier: string | null;
    residual_risk_classification: string | null;
    inherent_risk_classification: string | null;
    related_processes: RelatedProcessReference[];
  }>;
  ai_use_cases?: RelatedUseCaseReference[];
  skills?: Array<{
    identifier: string;
    id?: string | null;
    skill_id?: string | null;
    name: string | null;
    skill_name?: string | null;
    description: string | null;
    tags: string[] | null;
    inputModes?: string[] | null;
    outputModes?: string[] | null;
    input_modes?: string[] | null;
    output_modes?: string[] | null;
  }>;
  child_agents?: ChildAgentReference[];
  ai_models?: AgentAiModelReference[];
}

export interface AgentAiModelReference {
  ai_model_id: string;
  model_name: string | null;
  description: string | null;
  provider: string | null;
  status: string | null;
}

export interface BusinessApplicationUpsertPayload {
  business_application_id?: string | null;
  application_name?: string | null;
  emergency_tier?: string | null;
  business_owner?: string | null;
  application_portfolio_manager?: string | null;
  vendor_name?: string | null;
  business_criticality?: string | null;
  it_application_owner?: string | null;
  application_description?: string | null;
  embedded_ai?: string | null;
  opt_out_option?: string | null;
  privacy_policy_url?: string | null;
  data_excluded_from_ai_training?: string | null;
  vendor_description?: string | null;
  current_installed_version?: string | null;
  is_current_version_supported?: string | null;
  latest_released_version?: string | null;
  latest_release_date?: string | null;
  latest_release_documentation_link?: string | null;
}

export interface BusinessProcessUpsertPayload {
  business_process_id?: string | null;
  process_number?: string | null;
  process_name?: string | null;
  process_description?: string | null;
  parent_process_id?: string | null;
  stakeholders?: string | null;
  owner?: string | null;
  operators?: string | null;
  business_criticality?: string | null;
  reputational_impact?: string | null;
  financial_impact?: string | null;
  regulatory_impact?: string | null;
  sla?: string | null;
  process_health_state?: string | null;
}

export interface IntegrationRecord {
  integration_id: string;
  tenant_id: string | null;
  integration_name: string | null;
  integration_description: string | null;
  capabilities: string | null;
  protocol: string | null;
  endpoint_url: string | null;
  authentication_method: string | null;
  owner: string | null;
  documentation_url: string | null;
  data_sensitivity: string | null;
  rate_limit: string | null;
  availability_status: string | null;
  sla: string | null;
  version: string | null;
  parent_application_id: string | null;
  parent_application_name: string | null;
  related_agents: RelatedAgentReference[];
  related_agent_count: number;
  created_ts: string | null;
  updated_ts: string | null;
}

export interface IntegrationUpsertPayload {
  integration_id?: string | null;
  integration_name?: string | null;
  integration_description?: string | null;
  capabilities?: string | null;
  protocol?: string | null;
  endpoint_url?: string | null;
  authentication_method?: string | null;
  owner?: string | null;
  documentation_url?: string | null;
  data_sensitivity?: string | null;
  rate_limit?: string | null;
  availability_status?: string | null;
  sla?: string | null;
  version?: string | null;
  parent_application_id?: string | null;
}
