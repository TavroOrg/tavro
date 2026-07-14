-- Many-to-many junction: AI Model <-> Business Process.
-- Mirrors the ai_use_case_business_processes pure-junction pattern.
CREATE TABLE IF NOT EXISTS core.ai_model_business_processes (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	ai_model_id TEXT,
	ai_model_name TEXT,
	business_process_id TEXT,
	process_name TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_ai_model_business_processes_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_ai_model_business_processes_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
