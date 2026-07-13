CREATE TABLE IF NOT EXISTS core.agent_business_integrations (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	integration_id TEXT,
	agent_source_id TEXT,
	agent_name TEXT,
	agent_id TEXT,
	integration_name TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_agent_business_integrations_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_business_integrations_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
