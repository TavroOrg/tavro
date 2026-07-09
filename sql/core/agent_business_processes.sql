CREATE TABLE IF NOT EXISTS core.agent_business_processes (
	tenant_id TEXT,
	company_id TEXT,
	business_process_id TEXT,
	agent_id TEXT,
	process_name TEXT,
	process_stage TEXT,
	process_owner TEXT,
	business_function TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE) and
-- composite FK to core.business_processes (RESTRICT), using the composite
-- PK added in Critical #2. NOT VALID: safe on a live table with existing
-- data; validate later with
-- ALTER TABLE core.agent_business_processes VALIDATE CONSTRAINT fk_agent_business_processes_agent;
-- ALTER TABLE core.agent_business_processes VALIDATE CONSTRAINT fk_agent_business_processes_process;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_processes_agent') THEN
        ALTER TABLE core.agent_business_processes
            ADD CONSTRAINT fk_agent_business_processes_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_processes->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_processes_process') THEN
        ALTER TABLE core.agent_business_processes
            ADD CONSTRAINT fk_agent_business_processes_process
            FOREIGN KEY (tenant_id, company_id, business_process_id)
            REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_processes->business_processes FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_business_processes_tenant_id_present') THEN
        ALTER TABLE core.agent_business_processes
            ADD CONSTRAINT chk_agent_business_processes_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_processes: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_business_processes_company_id_present') THEN
        ALTER TABLE core.agent_business_processes
            ADD CONSTRAINT chk_agent_business_processes_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_processes: company_id CHECK skipped — %', SQLERRM;
END $$;

