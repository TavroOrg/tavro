CREATE TABLE IF NOT EXISTS core.agent_business_applications (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	business_application_id TEXT,
	agent_source_id TEXT,
	application_name TEXT,
	application_type TEXT,
	owning_team TEXT,
	business_owner TEXT,
	environment_name TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_id TEXT,
	CONSTRAINT chk_agent_business_applications_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_business_applications_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
