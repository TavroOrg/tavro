-- Persistent store for Agent Playground sessions.
-- Active sessions are kept in memory for speed; this table acts as the
-- durable record so sessions survive server restarts and user logouts.

CREATE TABLE IF NOT EXISTS core.playground_session (
    tenant_id           TEXT,
    company_id          TEXT,
    agent_internal_id   TEXT,
    agent_id            TEXT,
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
    ended_at            TIMESTAMPTZ
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_playground_session_tenant_id_present') THEN
        ALTER TABLE core.playground_session
            ADD CONSTRAINT chk_playground_session_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'playground_session: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_playground_session_company_id_present') THEN
        ALTER TABLE core.playground_session
            ADD CONSTRAINT chk_playground_session_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'playground_session: company_id CHECK skipped — %', SQLERRM;
END $$;

