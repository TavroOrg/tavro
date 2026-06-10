CREATE TABLE IF NOT EXISTS core.agent_tables (
  tenant_id         TEXT,
  agent_id          TEXT,
  agent_name        TEXT,
  agent_internal_id TEXT,
  table_id          TEXT,
  table_name        TEXT,
  created_ts        TIMESTAMP,
  updated_ts        TIMESTAMP
);
