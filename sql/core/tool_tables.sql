CREATE TABLE IF NOT EXISTS core.tool_tables (
  tenant_id  TEXT NOT NULL,
  company_id TEXT NOT NULL,
  tool_id    TEXT,
  tool_name  TEXT,
  table_id   TEXT,
  table_name TEXT,
  created_ts TIMESTAMP,
  updated_ts TIMESTAMP,
  CONSTRAINT chk_tool_tables_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_tool_tables_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
