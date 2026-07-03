CREATE TABLE IF NOT EXISTS core.business_process_business_applications (
	tenant_id TEXT,
	company_id TEXT,
	business_process_id TEXT,
	process_name TEXT,
	business_application_id TEXT,
	application_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
