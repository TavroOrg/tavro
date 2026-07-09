CREATE TABLE IF NOT EXISTS core.agent_business_integrations (
	tenant_id TEXT,
	company_id TEXT,
	integration_id TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	integration_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE, new)
-- and a new composite FK to core.business_integrations (RESTRICT), added
-- ALONGSIDE the existing single-column FK
-- (fk_core_agent_business_integrations_integration, added in
-- zz_agent_upsert_unique_indexes.sql) — that original FK is left untouched,
-- nothing is dropped. Uses the ux_core_business_integrations_tenant_company
-- UNIQUE added alongside business_integrations' original PK in Critical #2.
-- NOT VALID: safe on a live table with existing data; validate later with
-- ALTER TABLE core.agent_business_integrations VALIDATE CONSTRAINT fk_agent_business_integrations_agent;
-- ALTER TABLE core.agent_business_integrations VALIDATE CONSTRAINT fk_agent_business_integrations_integration;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_integrations_agent') THEN
        ALTER TABLE core.agent_business_integrations
            ADD CONSTRAINT fk_agent_business_integrations_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_integrations->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_integrations_integration') THEN
        ALTER TABLE core.agent_business_integrations
            ADD CONSTRAINT fk_agent_business_integrations_integration
            FOREIGN KEY (tenant_id, company_id, integration_id)
            REFERENCES core.business_integrations (tenant_id, company_id, integration_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_integrations->business_integrations FK skipped — %', SQLERRM;
END $$;
