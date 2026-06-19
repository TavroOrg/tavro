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

