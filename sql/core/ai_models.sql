CREATE TABLE IF NOT EXISTS core.ai_models (
	-- Identification & Accountability
	tenant_id TEXT,
	ai_model_id TEXT,
	model_name TEXT,
	owner TEXT,
	description TEXT,
	department_executive TEXT,
	business_functions TEXT,
	vendor_or_inhouse TEXT,
	provider TEXT,
	status TEXT,
	parent_model_id TEXT,
	version_number TEXT,

	-- Intended Use & Decision Impact
	use_case_value_drivers TEXT,
	user_types TEXT,
	decision_type TEXT,
	automation_level TEXT,
	regulatory_mapping TEXT,
	consumer_impact TEXT,
	risk_tier_materiality TEXT,

	-- Model Construct
	model_type TEXT,
	technique_class TEXT,
	learning_approach TEXT,
	update_frequency TEXT,
	input_variable_count TEXT,
	data_join_method TEXT,
	statistical_assumptions TEXT,
	documented_constraints TEXT,
	stability_window TEXT,

	-- Model Validation
	last_validation_date TEXT,

	-- Model Recertification
	recert_use_case_same TEXT,
	recert_use_case_changed TEXT,
	recert_inputs_same TEXT,
	recert_inputs_changed TEXT,
	recert_outputs_same TEXT,
	recert_outputs_changed TEXT,
	recert_users_same TEXT,
	recert_users_changed TEXT,
	recert_processing_same TEXT,
	recert_processing_changed TEXT,
	recert_training_completed TEXT,
	recert_risk_assessment_done TEXT,

	-- ARE / rollup
	business_criticality TEXT,
	emergency_tier TEXT,
	blended_risk_score NUMERIC,
	agent_risk_exposure NUMERIC,
	agent_risk_tier TEXT,
	inherent_risk_classification TEXT,
	residual_risk_classification TEXT,
	inherent_risk_classification_score NUMERIC,
	residual_risk_classification_score NUMERIC,
	no_of_associated_agents INTEGER,
	agent_internal_id TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);
