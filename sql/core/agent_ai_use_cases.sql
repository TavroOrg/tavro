CREATE TABLE IF NOT EXISTS core.agent_ai_use_cases (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  ai_use_case_id TEXT,
  ai_use_case_name TEXT,
  agent_id TEXT,
  agent_name TEXT,
  agent_internal_id TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  CONSTRAINT chk_agent_ai_use_cases_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_ai_use_cases_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
