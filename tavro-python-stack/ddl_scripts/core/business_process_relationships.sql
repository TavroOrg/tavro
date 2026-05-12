CREATE TABLE IF NOT EXISTS core.business_process_relationships (
    tenant_id TEXT,
    business_process_id TEXT,
    related_business_process_id TEXT,
    relationship_type TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);
