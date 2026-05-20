CREATE TABLE IF NOT EXISTS core.agent_business_processes (
	tenant_id TEXT,
	business_process_id TEXT,
	agent_id TEXT,
	process_name TEXT,
	process_stage TEXT,
	process_owner TEXT,
	business_function TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

