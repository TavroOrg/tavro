CREATE TABLE IF NOT EXISTS core.agent_generated_code (
  tenant_id TEXT,
  agent_internal_id TEXT,
  agent_id TEXT,
  filename TEXT,
  code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
