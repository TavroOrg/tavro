CREATE TABLE IF NOT EXISTS core.agent_llm_models (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  name TEXT,
  version_number TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

