-- Pure agent <-> AI model junction (mirrors core.agent_ai_use_cases).
-- All descriptive model attributes live in core.ai_models (the catalog).
CREATE TABLE IF NOT EXISTS core.agent_ai_models (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	ai_model_id TEXT,
	model_name TEXT,
	agent_source_id TEXT,
	agent_name TEXT,
	agent_id TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_agent_ai_models_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_ai_models_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
