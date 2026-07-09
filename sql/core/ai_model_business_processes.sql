-- Many-to-many junction: AI Model <-> Business Process.
-- Mirrors the ai_use_case_business_processes pure-junction pattern.
CREATE TABLE IF NOT EXISTS core.ai_model_business_processes (
	tenant_id TEXT,
	company_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	business_process_id TEXT,
	process_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): a new composite FK to core.ai_models added
-- ALONGSIDE the existing single-column FK
-- (fk_core_ai_model_business_processes_ai_model) — that original FK is
-- left untouched, nothing is dropped — plus a new composite FK to
-- core.business_processes. RESTRICT both sides — no "owning" side of this
-- catalog<->catalog junction. NOT VALID: safe on a live table with
-- existing data; validate later with
-- ALTER TABLE core.ai_model_business_processes VALIDATE CONSTRAINT fk_ai_model_business_processes_ai_model;
-- ALTER TABLE core.ai_model_business_processes VALIDATE CONSTRAINT fk_ai_model_business_processes_process;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_processes_ai_model') THEN
        ALTER TABLE core.ai_model_business_processes
            ADD CONSTRAINT fk_ai_model_business_processes_ai_model
            FOREIGN KEY (tenant_id, company_id, ai_model_id)
            REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_processes->ai_models FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_processes_process') THEN
        ALTER TABLE core.ai_model_business_processes
            ADD CONSTRAINT fk_ai_model_business_processes_process
            FOREIGN KEY (tenant_id, company_id, business_process_id)
            REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_business_processes->business_processes FK skipped — %', SQLERRM;
END $$;
