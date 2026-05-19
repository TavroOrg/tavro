CREATE TABLE IF NOT EXISTS core.agent_knowledge_sources (
  tenant_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  access_mechanism TEXT,
  description TEXT,
  source_type TEXT,
  connection_string TEXT,
  format TEXT,
  refresh_frequency TEXT,
  is_sensitive boolean,
  owner TEXT,
  status TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

