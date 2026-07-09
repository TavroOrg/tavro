-- Many-to-many junction: AI Model <-> AI Use Case.
-- Mirrors the agent_ai_use_cases / agent_ai_models pure-junction pattern.
-- Descriptive attributes live in core.ai_models and core.ai_use_cases.
CREATE TABLE IF NOT EXISTS core.ai_model_ai_use_cases (
	tenant_id TEXT,
	company_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	ai_use_case_id TEXT,
	ai_use_case_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): a new composite FK to core.ai_models,
-- added ALONGSIDE the existing single-column FK
-- (fk_core_ai_model_ai_use_cases_ai_model, added in
-- zz_agent_upsert_unique_indexes.sql) — that original FK is left untouched,
-- nothing is dropped. Uses ux_core_ai_models_tenant_company added in
-- Critical #2; plus a new composite FK to core.ai_use_cases. RESTRICT both
-- sides — no "owning" side of this catalog<->catalog junction. NOT VALID:
-- safe on a live table with existing data; validate later with
-- ALTER TABLE core.ai_model_ai_use_cases VALIDATE CONSTRAINT fk_ai_model_ai_use_cases_ai_model;
-- ALTER TABLE core.ai_model_ai_use_cases VALIDATE CONSTRAINT fk_ai_model_ai_use_cases_use_case;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_ai_use_cases_ai_model') THEN
        ALTER TABLE core.ai_model_ai_use_cases
            ADD CONSTRAINT fk_ai_model_ai_use_cases_ai_model
            FOREIGN KEY (tenant_id, company_id, ai_model_id)
            REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_ai_use_cases->ai_models FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_ai_use_cases_use_case') THEN
        ALTER TABLE core.ai_model_ai_use_cases
            ADD CONSTRAINT fk_ai_model_ai_use_cases_use_case
            FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
            REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ai_model_ai_use_cases->ai_use_cases FK skipped — %', SQLERRM;
END $$;
