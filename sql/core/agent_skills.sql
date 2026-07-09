CREATE TABLE IF NOT EXISTS core.agent_skills (
  tenant_id TEXT,
  company_id TEXT,
  skill_id TEXT,
  skill_name TEXT,
  agent_id TEXT,
  agent_name TEXT,
  agent_internal_id TEXT,
  created_ts timestamp,
  updated_ts timestamp
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- association is meaningless without the agent. skill_id is NOT FK'd here —
-- core.skills' global-vs-tenant catalog scoping is an open product decision
-- (README Low #4). NOT VALID: safe on a live table with existing data;
-- validate later with
-- ALTER TABLE core.agent_skills VALIDATE CONSTRAINT fk_agent_skills_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_skills_agent') THEN
        ALTER TABLE core.agent_skills
            ADD CONSTRAINT fk_agent_skills_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_skills: composite FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_skills_tenant_id_present') THEN
        ALTER TABLE core.agent_skills
            ADD CONSTRAINT chk_agent_skills_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_skills: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_skills_company_id_present') THEN
        ALTER TABLE core.agent_skills
            ADD CONSTRAINT chk_agent_skills_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_skills: company_id CHECK skipped — %', SQLERRM;
END $$;
