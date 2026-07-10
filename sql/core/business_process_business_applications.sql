CREATE TABLE IF NOT EXISTS core.business_process_business_applications (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	business_process_id TEXT,
	process_name TEXT,
	business_application_id TEXT,
	application_name TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	CONSTRAINT chk_business_process_business_applications_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_business_process_business_applications_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
