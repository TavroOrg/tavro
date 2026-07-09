CREATE TABLE IF NOT EXISTS core.agent_physical_ai (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  type TEXT,
  sensory_input_source TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_physical_ai VALIDATE CONSTRAINT fk_agent_physical_ai_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_physical_ai_agent') THEN
        ALTER TABLE core.agent_physical_ai
            ADD CONSTRAINT fk_agent_physical_ai_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_physical_ai: composite FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_physical_ai_tenant_id_present') THEN
        ALTER TABLE core.agent_physical_ai
            ADD CONSTRAINT chk_agent_physical_ai_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_physical_ai: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_physical_ai_company_id_present') THEN
        ALTER TABLE core.agent_physical_ai
            ADD CONSTRAINT chk_agent_physical_ai_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_physical_ai: company_id CHECK skipped — %', SQLERRM;
END $$;

