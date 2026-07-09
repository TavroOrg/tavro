-- Pure agent <-> AI model junction (mirrors core.agent_ai_use_cases).
-- All descriptive model attributes live in core.ai_models (the catalog).
CREATE TABLE IF NOT EXISTS core.agent_ai_models (
	tenant_id TEXT,
	company_id TEXT,
	ai_model_id TEXT,
	model_name TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE, new)
-- and a new composite FK to core.ai_models (RESTRICT), added ALONGSIDE the
-- existing single-column FK (fk_core_agent_ai_models_ai_model, added in
-- zz_agent_upsert_unique_indexes.sql) — that original FK is left untouched,
-- nothing is dropped. Uses ux_core_ai_models_tenant_company added alongside
-- ai_models' original key in Critical #2. NOT VALID: safe on a live table
-- with existing data; validate later with
-- ALTER TABLE core.agent_ai_models VALIDATE CONSTRAINT fk_agent_ai_models_agent;
-- ALTER TABLE core.agent_ai_models VALIDATE CONSTRAINT fk_agent_ai_models_ai_model;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_models_agent') THEN
        ALTER TABLE core.agent_ai_models
            ADD CONSTRAINT fk_agent_ai_models_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_models->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_models_ai_model') THEN
        ALTER TABLE core.agent_ai_models
            ADD CONSTRAINT fk_agent_ai_models_ai_model
            FOREIGN KEY (tenant_id, company_id, ai_model_id)
            REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_models->ai_models FK skipped — %', SQLERRM;
END $$;
