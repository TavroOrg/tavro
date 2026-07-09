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

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id, without requiring historic data to be clean first (NOT VALID).
-- No company_id CHECK here — this table has no company_id column;
-- ingestion happens before company resolution.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_card_json_tenant_id_present') THEN
        ALTER TABLE raw.agent_card_json
            ADD CONSTRAINT chk_agent_card_json_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'raw.agent_card_json: tenant_id CHECK skipped — %', SQLERRM;
END $$;

