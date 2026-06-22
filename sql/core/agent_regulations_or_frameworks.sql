CREATE TABLE IF NOT EXISTS core.agent_regulations_or_frameworks (
  tenant_id TEXT,
  company_id TEXT,
  agent_id TEXT,
  name TEXT,
  type TEXT,
  regulatory_authority TEXT,
  jurisdiction TEXT,
  requirement TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

