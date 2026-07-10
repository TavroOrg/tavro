CREATE TABLE IF NOT EXISTS core.agent_skills (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  skill_id TEXT,
  skill_name TEXT,
  agent_id TEXT,
  agent_name TEXT,
  agent_internal_id TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  CONSTRAINT chk_agent_skills_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_skills_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
