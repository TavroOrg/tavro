export interface AiModelRecord {
  tenant_id?: string | null;
  ai_model_id: string;
  // Identification & Accountability
  model_name: string | null;
  owner: string | null;
  description: string | null;
  department_executive: string | null;
  business_functions: string | null;
  vendor_or_inhouse: string | null;
  provider: string | null;
  status: string | null;
  parent_model_id: string | null;
  version_number: string | null;
  // Intended Use & Decision Impact
  use_case_value_drivers: string | null;
  user_types: string | null;
  decision_type: string | null;
  automation_level: string | null;
  regulatory_mapping: string | null;
  consumer_impact: string | null;
  risk_tier_materiality: string | null;
  // Model Construct
  model_type: string | null;
  technique_class: string | null;
  learning_approach: string | null;
  update_frequency: string | null;
  input_variable_count: string | null;
  data_join_method: string | null;
  statistical_assumptions: string | null;
  documented_constraints: string | null;
  stability_window: string | null;
  // Model Validation
  last_validation_date: string | null;
  // Model Recertification
  recert_use_case_same: string | null;
  recert_use_case_changed: string | null;
  recert_inputs_same: string | null;
  recert_inputs_changed: string | null;
  recert_outputs_same: string | null;
  recert_outputs_changed: string | null;
  recert_users_same: string | null;
  recert_users_changed: string | null;
  recert_processing_same: string | null;
  recert_processing_changed: string | null;
  recert_training_completed: string | null;
  recert_risk_assessment_done: string | null;
  // ARE
  business_criticality: string | null;
  emergency_tier: string | null;
  blended_risk_score: number | null;
  agent_risk_exposure: number | null;
  agent_risk_tier: string | null;
  inherent_risk_classification: string | null;
  residual_risk_classification: string | null;
  inherent_risk_classification_score: number | null;
  residual_risk_classification_score: number | null;
  // Meta
  no_of_associated_agents: number | null;
  related_agent_count?: number | null;
  agent_internal_id?: string | null;
  created_ts: string | null;
  updated_ts: string | null;
  // Present on GET /{id}
  agents?: AiModelAgentReference[];
  ai_use_cases?: AiModelUseCaseReference[];
  applications?: AiModelApplicationReference[];
  processes?: AiModelProcessReference[];
}

export interface AiModelApplicationReference {
  business_application_id: string;
  application_name: string | null;
  description: string | null;
  business_criticality: string | null;
  emergency_tier: string | null;
}

export interface AiModelProcessReference {
  business_process_id: string;
  process_name: string | null;
  description: string | null;
  business_criticality: string | null;
}

export interface AiModelAgentReference {
  agent_id: string | null;
  agent_internal_id: string | null;
  agent_name: string | null;
}

export interface AiModelUseCaseReference {
  ai_use_case_id: string;
  ai_use_case_name: string | null;
  description: string | null;
  owner: string | null;
  priority: string | null;
  status: string | null;
}

export type AiModelUpsertPayload = Partial<
  Omit<
    AiModelRecord,
    | 'ai_model_id'
    | 'tenant_id'
    | 'no_of_associated_agents'
    | 'related_agent_count'
    | 'agent_internal_id'
    | 'created_ts'
    | 'updated_ts'
    | 'agents'
    | 'ai_use_cases'
    | 'applications'
    | 'processes'
  >
>;

export interface AiModelAttachmentRecord {
  id: string;
  ai_model_id: string;
  category: string | null;
  filename: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

// Reference shape returned inside AgentRelationsPayload.ai_models
export interface AiModelReference {
  ai_model_id: string;
  model_name: string | null;
  description: string | null;
  provider: string | null;
  status: string | null;
}
