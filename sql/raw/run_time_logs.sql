CREATE TABLE IF NOT EXISTS raw.run_time_logs (
	tenant_id TEXT,
    tool_name TEXT,    
    arguments TEXT,
    created_ts timestamp
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id, without requiring historic data to be clean first (NOT VALID).
-- No company_id CHECK here — this table has no company_id column;
-- ingestion happens before company resolution.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_run_time_logs_tenant_id_present') THEN
        ALTER TABLE raw.run_time_logs
            ADD CONSTRAINT chk_run_time_logs_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'raw.run_time_logs: tenant_id CHECK skipped — %', SQLERRM;
END $$;
