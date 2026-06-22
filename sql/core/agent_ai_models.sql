-- Pure agent <-> AI model junction (mirrors core.agent_ai_use_cases).
-- All descriptive model attributes live in core.ai_models (the catalog).
CREATE TABLE IF NOT EXISTS core.agent_ai_models (
	tenant_id TEXT,
	company_id TEXT,
	ai_model_id TEXT,
	model_name TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
