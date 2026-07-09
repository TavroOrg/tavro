CREATE TABLE IF NOT EXISTS core.agent_prompt_templates (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  description TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT,
  mcp_server_id TEXT,
  arguments TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_prompt_templates VALIDATE CONSTRAINT fk_agent_prompt_templates_agent;
-- (mcp_server_id is not FK'd here — no unique constraint currently exists on
-- agent_mcp_servers.identifier to target)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompt_templates_agent') THEN
        ALTER TABLE core.agent_prompt_templates
            ADD CONSTRAINT fk_agent_prompt_templates_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_prompt_templates: composite FK skipped — %', SQLERRM;
END $$;

