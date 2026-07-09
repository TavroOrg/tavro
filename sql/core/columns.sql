CREATE TABLE IF NOT EXISTS core.columns (
    column_id TEXT PRIMARY KEY,
    company_id TEXT,
    tenant_id TEXT,
    name TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_columns_tenant_id_present') THEN
        ALTER TABLE core.columns
            ADD CONSTRAINT chk_columns_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'columns: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_columns_company_id_present') THEN
        ALTER TABLE core.columns
            ADD CONSTRAINT chk_columns_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'columns: company_id CHECK skipped — %', SQLERRM;
END $$;
