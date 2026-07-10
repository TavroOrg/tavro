CREATE TABLE IF NOT EXISTS raw.ingestion_log (
	tenant_id TEXT NOT NULL,
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
	created_at timestamp,
	CONSTRAINT chk_ingestion_log_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '')
);
