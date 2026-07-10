CREATE TABLE IF NOT EXISTS core.agent_tables (
  tenant_id         TEXT NOT NULL,
  company_id        TEXT NOT NULL,
  agent_id          TEXT,
  agent_name        TEXT,
  agent_internal_id TEXT,
  table_id          TEXT,
  table_name        TEXT,
  created_ts        TIMESTAMP,
  updated_ts        TIMESTAMP,
  CONSTRAINT chk_agent_tables_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_tables_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
