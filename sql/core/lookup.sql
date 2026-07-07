CREATE TABLE IF NOT EXISTS public.lookup (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  company_id TEXT,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  sequence INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_ts TIMESTAMP,
  updated_ts TIMESTAMP
);
