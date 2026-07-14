CREATE TABLE IF NOT EXISTS core.table_columns (
  tenant_id   TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  table_id    TEXT,
  table_name  TEXT,
  column_name TEXT,
  column_id   TEXT,
  created_ts  TIMESTAMP,
  updated_ts  TIMESTAMP,
  CONSTRAINT chk_table_columns_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_table_columns_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
