CREATE TABLE IF NOT EXISTS core.agent_ai_models (
	tenant_id TEXT,
	ai_model_id TEXT,
	agent_id TEXT,
	model_name TEXT,
	model_provider TEXT,
	model_version TEXT,
	model_type TEXT,
	is_primary_model boolean,
	usage_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	owner TEXT,
	department_executive TEXT,
	description TEXT,
	agent_internal_id TEXT
);

