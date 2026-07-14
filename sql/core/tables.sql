CREATE TABLE IF NOT EXISTS core.tables (
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    table_id TEXT PRIMARY KEY,
    name TEXT,
    country_of_provenance TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP,
    CONSTRAINT chk_tables_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_tables_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
