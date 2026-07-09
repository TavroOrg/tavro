-- Many-to-many junction: AI Model <-> Business Application.
-- Mirrors the ai_use_case_business_applications pure-junction pattern.
CREATE TABLE IF NOT EXISTS core.ai_model_business_applications (
	tenant_id TEXT,
	company_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	business_application_id TEXT,
	application_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): a new composite FK to core.ai_models added
-- ALONGSIDE the existing single-column FK
-- (fk_core_ai_model_business_applications_ai_model) — that original FK is
-- left untouched, nothing is dropped — plus a new composite FK to
-- core.business_applications. RESTRICT both sides — no "owning" side of
-- this catalog<->catalog junction. NOT VALID: safe on a live table with
-- existing data; validate later with
-- ALTER TABLE core.ai_model_business_applications VALIDATE CONSTRAINT fk_ai_model_business_applications_ai_model;
-- ALTER TABLE core.ai_model_business_applications VALIDATE CONSTRAINT fk_ai_model_business_applications_application;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_applications_ai_model') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT fk_ai_model_business_applications_ai_model
            FOREIGN KEY (tenant_id, company_id, ai_model_id)
            REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_applications->ai_models FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_applications_application') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT fk_ai_model_business_applications_application
            FOREIGN KEY (tenant_id, company_id, business_application_id)
            REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_applications->business_applications FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_business_applications_tenant_id_present') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT chk_ai_model_business_applications_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_applications: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_business_applications_company_id_present') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT chk_ai_model_business_applications_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_applications: company_id CHECK skipped — %', SQLERRM;
END $$;
