-- Persistent store for Agent Playground sessions.
-- Active sessions are kept in memory for speed; this table acts as the
-- durable record so sessions survive server restarts and user logouts.

CREATE TABLE IF NOT EXISTS core.playground_session (
    tenant_id           TEXT NOT NULL,
    company_id          TEXT NOT NULL,
    agent_id            TEXT,
    agent_source_id     TEXT,
    session_id          TEXT            PRIMARY KEY,
    agent_name          TEXT,
    provider            TEXT,
    model               TEXT,
    interactions        JSONB           NOT NULL DEFAULT '[]',
    token_total         INTEGER         NOT NULL DEFAULT 0,
    observations        JSONB           NOT NULL DEFAULT '[]',
    summary             JSONB,
    status              TEXT            NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    CONSTRAINT chk_playground_session_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_playground_session_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
