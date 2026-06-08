CREATE TABLE IF NOT EXISTS core.agent_issues (
	tenant_id TEXT,
	issue_id TEXT,
	issue_name TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);

