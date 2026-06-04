CREATE TABLE IF NOT EXISTS core.tool_tables (
  tenant_id         TEXT,
  tool_id           TEXT,
  tool_name         TEXT,
  table_id          TEXT,
  table_name        TEXT,
  agent_id          TEXT,
  agent_internal_id TEXT,
  created_ts        TIMESTAMP,
  updated_ts        TIMESTAMP
);
