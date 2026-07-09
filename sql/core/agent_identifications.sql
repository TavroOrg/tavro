CREATE TABLE IF NOT EXISTS core.agent_identifications (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  goal_orientation TEXT,
  role TEXT,
  instruction TEXT,
  owner TEXT,
  environment TEXT,
  tags TEXT[],
  governance_status TEXT,
  reviewer TEXT,
  cost_center TEXT,
  is_current boolean,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_identifications VALIDATE CONSTRAINT fk_agent_identifications_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_identifications_agent') THEN
        ALTER TABLE core.agent_identifications
            ADD CONSTRAINT fk_agent_identifications_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_identifications: composite FK skipped — %', SQLERRM;
END $$;

