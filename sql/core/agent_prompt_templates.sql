CREATE TABLE IF NOT EXISTS core.agent_prompt_templates (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  description TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT,
  mcp_server_id TEXT,
  arguments TEXT
);

