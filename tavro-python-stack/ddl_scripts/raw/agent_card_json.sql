CREATE TABLE IF NOT EXISTS raw.agent_card_json (
	tenant_id TEXT,
	ingest_id TEXT,
	source_file_name TEXT,
	source_file_path TEXT,
	source_system TEXT,
	agent_id TEXT,
	agent_internal_id TEXT,
	card_version TEXT,
	payload_json_text TEXT,
	payload_hash TEXT,
	ingestion_run_id TEXT,
	ingested_at timestamp,
	is_valid_json boolean,
	load_status TEXT,
	load_error_message TEXT
);

