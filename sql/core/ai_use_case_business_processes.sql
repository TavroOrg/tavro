CREATE TABLE IF NOT EXISTS core.ai_use_case_business_processes (
    tenant_id TEXT,
    company_id TEXT,
    ai_use_case_id TEXT,
    business_process_id TEXT,
    process_name TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);

-- High #2 (audit_db/README.md): composite FK to core.ai_use_cases and
-- composite FK to core.business_processes, using the composite PKs added
-- in Critical #2. RESTRICT both sides — no "owning" side of this
-- catalog<->catalog junction. NOT VALID: safe on a live table with
-- existing data; validate later with
-- ALTER TABLE core.ai_use_case_business_processes VALIDATE CONSTRAINT fk_ai_use_case_business_processes_use_case;
-- ALTER TABLE core.ai_use_case_business_processes VALIDATE CONSTRAINT fk_ai_use_case_business_processes_process;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_processes_use_case') THEN
        ALTER TABLE core.ai_use_case_business_processes
            ADD CONSTRAINT fk_ai_use_case_business_processes_use_case
            FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
            REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_use_case_business_processes->ai_use_cases FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_processes_process') THEN
        ALTER TABLE core.ai_use_case_business_processes
            ADD CONSTRAINT fk_ai_use_case_business_processes_process
            FOREIGN KEY (tenant_id, company_id, business_process_id)
            REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_use_case_business_processes->business_processes FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_use_case_business_processes_tenant_id_present') THEN
        ALTER TABLE core.ai_use_case_business_processes
            ADD CONSTRAINT chk_ai_use_case_business_processes_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_use_case_business_processes: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_use_case_business_processes_company_id_present') THEN
        ALTER TABLE core.ai_use_case_business_processes
            ADD CONSTRAINT chk_ai_use_case_business_processes_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_use_case_business_processes: company_id CHECK skipped — %', SQLERRM;
END $$;
