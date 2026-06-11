-- Many-to-many junction: AI Model <-> AI Use Case.
-- Mirrors the agent_ai_use_cases / agent_ai_models pure-junction pattern.
-- Descriptive attributes live in core.ai_models and core.ai_use_cases.
CREATE TABLE IF NOT EXISTS core.ai_model_ai_use_cases (
	tenant_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	ai_use_case_id TEXT,
	ai_use_case_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
