CREATE TABLE IF NOT EXISTS raw.ingestion_log (
	tenant_id TEXT,
	ingestion_run_id TEXT,
	pipeline_name TEXT,
	pipeline_version TEXT,
	source_system TEXT,
	file_count bigint,
	record_count bigint,
	success_count bigint,
	failure_count bigint,
	started_at timestamp,
	completed_at timestamp,
	status TEXT,
	error_summary TEXT,
	created_at timestamp
);

