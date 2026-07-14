CREATE TABLE IF NOT EXISTS core.ai_use_case_business_applications (
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    ai_use_case_id TEXT,
    business_application_id TEXT,
    application_name TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP,
    CONSTRAINT chk_ai_use_case_business_applications_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_ai_use_case_business_applications_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
