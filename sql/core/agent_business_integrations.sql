CREATE TABLE IF NOT EXISTS core.agent_business_integrations (
	tenant_id TEXT,
	integration_id TEXT,
	agent_id TEXT,
	agent_internal_id TEXT,
	integration_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
