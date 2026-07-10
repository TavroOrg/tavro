CREATE TABLE IF NOT EXISTS core.tools (
	tenant_id TEXT NOT NULL,
	tool_id TEXT,
	company_id TEXT NOT NULL,
	tool_name TEXT,
	tool_description TEXT,
	delegation_possible boolean,
	allowed_delegates TEXT,
	input_schema_json_text TEXT,
	output_schema_json_text TEXT,
	default_config_json_text TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_tools_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_tools_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
