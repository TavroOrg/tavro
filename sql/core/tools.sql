CREATE TABLE IF NOT EXISTS core.tools (
	tenant_id TEXT,
	tool_id TEXT,
	company_id TEXT,
	tool_name TEXT,
	tool_description TEXT,
	delegation_possible boolean,
	allowed_delegates TEXT,
	input_schema_json_text TEXT,
	output_schema_json_text TEXT,
	default_config_json_text TEXT,
	created_ts timestamp,
	updated_ts timestamp
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tools_tenant_id_present') THEN
        ALTER TABLE core.tools
            ADD CONSTRAINT chk_tools_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tools: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tools_company_id_present') THEN
        ALTER TABLE core.tools
            ADD CONSTRAINT chk_tools_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tools: company_id CHECK skipped — %', SQLERRM;
END $$;
