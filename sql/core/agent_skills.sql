CREATE TABLE IF NOT EXISTS core.agent_skills (
  tenant_id TEXT,
  skill_id TEXT,
  skill_name TEXT,
  agent_id TEXT,
  agent_name TEXT,
  agent_internal_id TEXT,
  created_ts timestamp,
  updated_ts timestamp
);
