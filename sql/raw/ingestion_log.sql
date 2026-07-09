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

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id, without requiring historic data to be clean first (NOT VALID).
-- No company_id CHECK here — this table has no company_id column;
-- ingestion happens before company resolution.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ingestion_log_tenant_id_present') THEN
        ALTER TABLE raw.ingestion_log
            ADD CONSTRAINT chk_ingestion_log_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'raw.ingestion_log: tenant_id CHECK skipped — %', SQLERRM;
END $$;

