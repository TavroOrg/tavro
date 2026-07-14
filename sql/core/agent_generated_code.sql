CREATE TABLE IF NOT EXISTS core.agent_generated_code (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  agent_id TEXT,
  agent_source_id TEXT,
  filename TEXT,
  code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_agent_generated_code_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_generated_code_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
