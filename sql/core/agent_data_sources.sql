CREATE TABLE IF NOT EXISTS core.agent_data_sources (
	tenant_id TEXT,
	company_id TEXT,
	agent_id TEXT,
    access_level TEXT,
    contains_pii boolean,
    contains_phi boolean,
    contains_pci boolean,
    created_ts timestamp,
    updated_ts timestamp,
    relationship_id TEXT,
    parent_relationship_id TEXT,
    source_object_id TEXT,
    source_object_domain TEXT,
    source_object_name TEXT,
    source_object_type TEXT,
    target_object_id TEXT,
    target_object_domain TEXT,
    target_object_name TEXT,
    target_object_type TEXT,
    agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_data_sources VALIDATE CONSTRAINT fk_agent_data_sources_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_data_sources_agent') THEN
        ALTER TABLE core.agent_data_sources
            ADD CONSTRAINT fk_agent_data_sources_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_data_sources: composite FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_data_sources_tenant_id_present') THEN
        ALTER TABLE core.agent_data_sources
            ADD CONSTRAINT chk_agent_data_sources_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_data_sources: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_data_sources_company_id_present') THEN
        ALTER TABLE core.agent_data_sources
            ADD CONSTRAINT chk_agent_data_sources_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_data_sources: company_id CHECK skipped — %', SQLERRM;
END $$;

