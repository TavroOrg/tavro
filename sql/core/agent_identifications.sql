CREATE TABLE IF NOT EXISTS core.agent_identifications (
  tenant_id TEXT,
  agent_id TEXT,
  goal_orientation TEXT,
  role TEXT,
  instruction TEXT,
  owner TEXT,
  environment TEXT,
  tags TEXT[],
  governance_status TEXT,
  reviewer TEXT,
  cost_center TEXT,
  is_current boolean,
  created_ts timestamp,
  updated_ts timestamp,
  agent_internal_id TEXT
);

