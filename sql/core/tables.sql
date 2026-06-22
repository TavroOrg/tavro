CREATE TABLE IF NOT EXISTS core.tables (
    tenant_id TEXT,
    company_id TEXT,
    table_id TEXT PRIMARY KEY,
    name TEXT,
    country_of_provenance TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);
