CREATE TABLE IF NOT EXISTS core.agent_physical_ai (
  tenant_id TEXT,
  agent_id TEXT,
  identifier TEXT,
  name TEXT,
  type TEXT,
  sensory_input_source TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

