CREATE TABLE IF NOT EXISTS core.agent_generated_code (
  tenant_id TEXT,
  company_id TEXT,
  agent_internal_id TEXT,
  agent_id TEXT,
  filename TEXT,
  code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_generated_code VALIDATE CONSTRAINT fk_agent_generated_code_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_generated_code_agent') THEN
        ALTER TABLE core.agent_generated_code
            ADD CONSTRAINT fk_agent_generated_code_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_generated_code: composite FK skipped — %', SQLERRM;
END $$;
