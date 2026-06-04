-- =============================================================
-- Admin Schema — Configuration persistence for the Admin Portal
-- =============================================================

CREATE SCHEMA IF NOT EXISTS admin;

-- LLM provider keys (encrypted at rest)
-- Supports the GitHub Copilot SDK providers: OpenAI / Azure OpenAI / Anthropic BYOK
CREATE TABLE IF NOT EXISTS admin.llm_keys (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT        NOT NULL,
    provider          TEXT        NOT NULL
                      CHECK (provider IN ('openai', 'azure_openai', 'anthropic')),
    model             TEXT        NOT NULL,
    api_key_enc       TEXT        NOT NULL,
    -- Azure-specific extras (NULL for non-Azure providers)
    azure_endpoint    TEXT,
    azure_api_version TEXT,
    is_active         BOOLEAN     NOT NULL DEFAULT false,
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

-- Seed well-known config keys so the Settings page always has rows to update
INSERT INTO admin.config (key, value_enc, encrypted, description) VALUES
    ('mcp_portal_url',        NULL, false, 'MCP Portal URL shown to users'),
    ('api_url',               NULL, false, 'External API base URL'),
    ('api_key',               NULL, true,  'External API key (encrypted)'),
    ('zitadel_issuer',        NULL, false, 'Zitadel issuer URL'),
    ('zitadel_client_id',     NULL, false, 'Zitadel client ID'),
    ('zitadel_client_secret', NULL, true,  'Zitadel client secret (encrypted)')
ON CONFLICT (key) DO NOTHING;
