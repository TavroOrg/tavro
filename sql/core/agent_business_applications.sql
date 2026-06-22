CREATE TABLE IF NOT EXISTS core.agent_business_applications (
	tenant_id TEXT,
	company_id TEXT,
	business_application_id TEXT,
	agent_id TEXT,
	application_name TEXT,
	application_type TEXT,
	owning_team TEXT,
	business_owner TEXT,
	environment_name TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

