CREATE TABLE IF NOT EXISTS core.columns (
    column_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    name TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP,
    CONSTRAINT chk_columns_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_columns_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
