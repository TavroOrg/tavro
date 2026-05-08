CREATE TABLE IF NOT EXISTS core.agent_mcp_servers (
  tenant_id TEXT,
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
  source_hash TEXT
);

