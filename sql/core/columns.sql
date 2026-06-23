CREATE TABLE IF NOT EXISTS core.columns (
    column_id TEXT PRIMARY KEY,
    company_id TEXT,
    tenant_id TEXT,
    name TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);
