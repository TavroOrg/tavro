CREATE TABLE IF NOT EXISTS core.agent_business_processes (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	business_process_id TEXT,
	agent_source_id TEXT,
	process_name TEXT,
	process_stage TEXT,
	process_owner TEXT,
	business_function TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_id TEXT,
	CONSTRAINT chk_agent_business_processes_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_business_processes_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
