-- =============================================================
-- Admin Schema — Configuration persistence for the Admin Portal
-- =============================================================

CREATE SCHEMA IF NOT EXISTS admin;

-- LLM provider keys (encrypted at rest)
CREATE TABLE IF NOT EXISTS admin.llm_keys (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT        NOT NULL,
    provider          TEXT        NOT NULL
                      CHECK (provider IN ('github_copilot', 'openai', 'azure_openai', 'anthropic')),
    model             TEXT        NOT NULL,
    api_key_enc       TEXT        NOT NULL,
    azure_endpoint    TEXT,
    azure_api_version TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT llm_keys_provider_unique UNIQUE (provider)
);

-- Generic key-value config store (sensitive values are stored encrypted)
CREATE TABLE IF NOT EXISTS admin.config (
    key         TEXT        PRIMARY KEY,
    value_enc   TEXT,
    encrypted   BOOLEAN     NOT NULL DEFAULT false,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the MCP Portal URL config key
INSERT INTO admin.config (key, value_enc, encrypted, description) VALUES
    ('mcp_portal_url', NULL, false, 'MCP Portal URL shown to users')
ON CONFLICT (key) DO NOTHING;
