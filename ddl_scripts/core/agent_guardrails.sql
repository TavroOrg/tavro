CREATE TABLE IF NOT EXISTS core.agent_guardrails (
  tenant_id TEXT,
  agent_id TEXT,
  name TEXT,
  description TEXT,
  model TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

