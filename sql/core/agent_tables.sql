CREATE TABLE IF NOT EXISTS core.agent_tables (
  tenant_id         TEXT,
  company_id        TEXT,
  agent_id          TEXT,
  agent_name        TEXT,
  agent_internal_id TEXT,
  table_id          TEXT,
  table_name        TEXT,
  created_ts        TIMESTAMP,
  updated_ts        TIMESTAMP
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE — this
-- association is meaningless without the agent) and single-column FK to
-- core.tables (RESTRICT — core.tables' key was not part of the Critical #2
-- composite rollout). NOT VALID: safe on a live table with existing data;
-- validate later with
-- ALTER TABLE core.agent_tables VALIDATE CONSTRAINT fk_agent_tables_agent;
-- ALTER TABLE core.agent_tables VALIDATE CONSTRAINT fk_agent_tables_table;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tables_agent') THEN
        ALTER TABLE core.agent_tables
            ADD CONSTRAINT fk_agent_tables_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_tables->agents composite FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tables_table') THEN
        ALTER TABLE core.agent_tables
            ADD CONSTRAINT fk_agent_tables_table
            FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_tables->tables FK skipped — %', SQLERRM;
END $$;
