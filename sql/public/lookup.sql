CREATE TABLE IF NOT EXISTS public.lookup (
  id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_public_lookup
ON public.lookup (tenant_id, company_id, table_name, column_name, value);

CREATE INDEX IF NOT EXISTS ix_public_lookup_lookup
ON public.lookup (tenant_id, table_name, column_name, active, sequence);
