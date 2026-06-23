CREATE TABLE IF NOT EXISTS core.tool_tables (
  tenant_id  TEXT,
  company_id TEXT,
  tool_id    TEXT,
  tool_name  TEXT,
  table_id   TEXT,
  table_name TEXT,
  created_ts TIMESTAMP,
  updated_ts TIMESTAMP
);
