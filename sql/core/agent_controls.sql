CREATE TABLE IF NOT EXISTS core.agent_controls (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  objective TEXT,
  domain TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT,
  CONSTRAINT chk_agent_controls_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_controls_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
