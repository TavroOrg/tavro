CREATE TABLE IF NOT EXISTS core.agent_tools (
	tenant_id TEXT,
	company_id TEXT,
	agent_internal_id TEXT,
	agent_id TEXT,
	agent_name TEXT,
	tool_id TEXT,
	tool_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

