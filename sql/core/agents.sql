CREATE TABLE IF NOT EXISTS core.agents (
	tenant_id TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_description TEXT,
	protocol_version TEXT,
	preferred_transport TEXT,
	supports_auth_ext_card boolean,
	card_version TEXT,
	source_hash TEXT,
	source_system TEXT,
	record_hash TEXT,
	valid_from_ts timestamp,
	valid_to_ts timestamp,
	is_current boolean,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

