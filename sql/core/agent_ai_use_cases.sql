CREATE TABLE IF NOT EXISTS core.agent_ai_use_cases (
  tenant_id TEXT,
  company_id TEXT,
  ai_use_case_id TEXT,
  ai_use_case_name TEXT,
  agent_id TEXT,
  agent_name TEXT,
  agent_internal_id TEXT,
  created_ts timestamp,
  updated_ts timestamp
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE) and
-- composite FK to core.ai_use_cases (RESTRICT), using the composite PK
-- added in Critical #2. NOT VALID: safe on a live table with existing
-- data; validate later with
-- ALTER TABLE core.agent_ai_use_cases VALIDATE CONSTRAINT fk_agent_ai_use_cases_agent;
-- ALTER TABLE core.agent_ai_use_cases VALIDATE CONSTRAINT fk_agent_ai_use_cases_use_case;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_use_cases_agent') THEN
        ALTER TABLE core.agent_ai_use_cases
            ADD CONSTRAINT fk_agent_ai_use_cases_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_use_cases->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_use_cases_use_case') THEN
        ALTER TABLE core.agent_ai_use_cases
            ADD CONSTRAINT fk_agent_ai_use_cases_use_case
            FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
            REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_use_cases->ai_use_cases FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_ai_use_cases_tenant_id_present') THEN
        ALTER TABLE core.agent_ai_use_cases
            ADD CONSTRAINT chk_agent_ai_use_cases_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_use_cases: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_ai_use_cases_company_id_present') THEN
        ALTER TABLE core.agent_ai_use_cases
            ADD CONSTRAINT chk_agent_ai_use_cases_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_ai_use_cases: company_id CHECK skipped — %', SQLERRM;
END $$;

