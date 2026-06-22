CREATE TABLE IF NOT EXISTS core.agent_controls (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  objective TEXT,
  domain TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

