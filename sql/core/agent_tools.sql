CREATE TABLE IF NOT EXISTS core.agent_tools (
	tenant_id TEXT,
	company_id TEXT,
	agent_internal_id TEXT,
	agent_id TEXT,
	agent_name TEXT,
	tool_id TEXT,
	tool_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- association is meaningless without the agent. tool_id is NOT FK'd here —
-- core.tools' global-vs-tenant catalog scoping is an open product decision
-- (README Low #4). NOT VALID: safe on a live table with existing data;
-- validate later with
-- ALTER TABLE core.agent_tools VALIDATE CONSTRAINT fk_agent_tools_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tools_agent') THEN
        ALTER TABLE core.agent_tools
            ADD CONSTRAINT fk_agent_tools_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_tools: composite FK skipped — %', SQLERRM;
END $$;

