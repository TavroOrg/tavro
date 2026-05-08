CREATE TABLE IF NOT EXISTS core.agent_memories (
  tenant_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  type TEXT,
  status TEXT,
  description TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

