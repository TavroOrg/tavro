CREATE TABLE IF NOT EXISTS core.table_columns (
  tenant_id   TEXT,
  table_id    TEXT,
  table_name  TEXT,
  column_name TEXT,
  column_id   TEXT,
  created_ts  TIMESTAMP,
  updated_ts  TIMESTAMP
);
