CREATE TABLE IF NOT EXISTS core.agent_issues (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	issue_id TEXT,
	title TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP,
	CONSTRAINT chk_agent_issues_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_issues_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
