CREATE TABLE IF NOT EXISTS core.agent_configurations (
	tenant_id TEXT,
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

