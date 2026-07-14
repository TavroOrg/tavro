CREATE TABLE IF NOT EXISTS core.agent_tools (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	agent_id TEXT,
	agent_source_id TEXT,
	agent_name TEXT,
	tool_id TEXT,
	tool_name TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_agent_tools_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_tools_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
