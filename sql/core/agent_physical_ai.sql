CREATE TABLE IF NOT EXISTS core.agent_physical_ai (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  agent_source_id TEXT,
  identifier TEXT,
  name TEXT,
  type TEXT,
  sensory_input_source TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_id TEXT,
  CONSTRAINT chk_agent_physical_ai_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_physical_ai_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
