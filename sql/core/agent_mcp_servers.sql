CREATE TABLE IF NOT EXISTS core.agent_mcp_servers (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  name TEXT,
  url TEXT,
  version_number TEXT,
  status TEXT,
  last_updated_ts timestamp,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT,
  identifier TEXT,
  source_hash TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_mcp_servers VALIDATE CONSTRAINT fk_agent_mcp_servers_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_mcp_servers_agent') THEN
        ALTER TABLE core.agent_mcp_servers
            ADD CONSTRAINT fk_agent_mcp_servers_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_mcp_servers: composite FK skipped — %', SQLERRM;
END $$;

