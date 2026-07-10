CREATE TABLE IF NOT EXISTS core.agent_mcp_servers (
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  agent_id TEXT,
  name TEXT,
  url TEXT,
  version_number TEXT,
  status TEXT,
  last_updated_ts timestamp,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT,
  identifier TEXT,
  source_hash TEXT,
  CONSTRAINT chk_agent_mcp_servers_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
  CONSTRAINT chk_agent_mcp_servers_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
