CREATE TABLE IF NOT EXISTS core.agent_governance_events (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	governance_event_id TEXT,
	agent_id TEXT,
	event_type TEXT,
	event_ts timestamp,
	actor_name TEXT,
	status TEXT,
	notes TEXT,
	created_ts timestamp,
	agent_internal_id TEXT,
	CONSTRAINT chk_agent_governance_events_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_agent_governance_events_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
