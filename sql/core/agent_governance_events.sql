CREATE TABLE IF NOT EXISTS core.agent_governance_events (
	tenant_id TEXT,
	company_id TEXT,
	governance_event_id TEXT,
	agent_id TEXT,
	event_type TEXT,
	event_ts timestamp,
	actor_name TEXT,
	status TEXT,
	notes TEXT,
	created_ts timestamp,
	agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. SET NULL, not
-- CASCADE — governance/audit events should outlive the agent they were
-- logged against rather than disappear when the agent is deleted. NOT VALID:
-- safe on a live table with existing data; validate later with
-- ALTER TABLE core.agent_governance_events VALIDATE CONSTRAINT fk_agent_governance_events_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_governance_events_agent') THEN
        ALTER TABLE core.agent_governance_events
            ADD CONSTRAINT fk_agent_governance_events_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE SET NULL NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_governance_events: composite FK skipped — %', SQLERRM;
END $$;

