CREATE TABLE IF NOT EXISTS agent_library.catalog (
    catalog_id        TEXT,
    tenant_id         TEXT,
    agent_id          TEXT,
    agent_internal_id TEXT,
    agent_name        TEXT,
    summary           TEXT,
    industry          TEXT,
    generated_ts      TIMESTAMP,
    snapshot_ts       TIMESTAMP
);
