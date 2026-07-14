CREATE TABLE IF NOT EXISTS raw.run_time_logs (
	tenant_id TEXT NOT NULL,
    tool_name TEXT,
    arguments TEXT,
    created_ts timestamp,
    CONSTRAINT chk_run_time_logs_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '')
);
