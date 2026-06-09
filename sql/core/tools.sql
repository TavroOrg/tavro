CREATE TABLE IF NOT EXISTS core.tools (
	tenant_id TEXT,
	tool_id TEXT,
	tool_name TEXT,
	tool_description TEXT,
	delegation_possible boolean,
	allowed_delegates TEXT,
	input_schema_json_text TEXT,
	output_schema_json_text TEXT,
	default_config_json_text TEXT,
	mcp_server_id TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
