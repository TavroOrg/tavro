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

-- High #2 (audit_db/README.md): composite FK to core.business_processes
-- and composite FK to core.business_applications, using the composite PKs
-- added in Critical #2. RESTRICT both sides — no "owning" side of this
-- catalog<->catalog junction. NOT VALID: safe on a live table with
-- existing data; validate later with
-- ALTER TABLE core.business_process_business_applications VALIDATE CONSTRAINT fk_business_process_business_applications_process;
-- ALTER TABLE core.business_process_business_applications VALIDATE CONSTRAINT fk_business_process_business_applications_application;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_process_business_applications_process') THEN
        ALTER TABLE core.business_process_business_applications
            ADD CONSTRAINT fk_business_process_business_applications_process
            FOREIGN KEY (tenant_id, company_id, business_process_id)
            REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'business_process_business_applications->business_processes FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_process_business_applications_application') THEN
        ALTER TABLE core.business_process_business_applications
            ADD CONSTRAINT fk_business_process_business_applications_application
            FOREIGN KEY (tenant_id, company_id, business_application_id)
            REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'business_process_business_applications->business_applications FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_process_business_applications_tenant_id_present') THEN
        ALTER TABLE core.business_process_business_applications
            ADD CONSTRAINT chk_business_process_business_applications_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'business_process_business_applications: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_process_business_applications_company_id_present') THEN
        ALTER TABLE core.business_process_business_applications
            ADD CONSTRAINT chk_business_process_business_applications_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'business_process_business_applications: company_id CHECK skipped — %', SQLERRM;
END $$;
