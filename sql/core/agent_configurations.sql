CREATE TABLE IF NOT EXISTS core.agent_configurations (
	tenant_id TEXT,
	company_id TEXT,
	agent_id TEXT,
	access_scope TEXT,
	memory_type TEXT,
	data_freshness_policy TEXT,
	autonomy_level TEXT,
	reasoning_model TEXT,
	human_in_the_loop_flag boolean,
	execution_mode TEXT,
	record_hash TEXT,
	valid_from_ts timestamp,
	valid_to_ts timestamp,
	is_current boolean,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. CASCADE — this
-- row has no meaning once its agent is deleted. NOT VALID: safe on a live
-- table with existing data; validate later with
-- ALTER TABLE core.agent_configurations VALIDATE CONSTRAINT fk_agent_configurations_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_configurations_agent') THEN
        ALTER TABLE core.agent_configurations
            ADD CONSTRAINT fk_agent_configurations_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_configurations: composite FK skipped — %', SQLERRM;
END $$;

