-- =============================================================
-- sql/audit_ddl.sql
-- Compliance Audit tables — audit runs and per-finding results.
-- Run after compliance_ddl.sql.
-- =============================================================

-- ── Audit run ─────────────────────────────────────────────────────────────────
-- One row per audit execution (could cover many use case × regulation pairs).

CREATE TABLE IF NOT EXISTS twin.audit_run (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,

    -- Scope
    scope_type        TEXT NOT NULL CHECK (scope_type IN (
                          'single',        -- one use case × one regulation
                          'use_case_all',  -- one use case × all regulations/policies
                          'catalog_single',-- all use cases × one regulation
                          'full'           -- all use cases × all regulations
                      )),

    -- Target identifiers (null = "all")
    use_case_id       TEXT,         -- external ID from MCP catalog
    use_case_name     TEXT,
    agent_id          TEXT,         -- if scoped to a specific agent
    agent_name        TEXT,
    compliance_item_id UUID REFERENCES twin.compliance_item(id) ON DELETE SET NULL,
    compliance_item_name TEXT,

    -- Status
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed','cancelled')),
    total_pairs       INT NOT NULL DEFAULT 0,  -- use case × regulation pairs to assess
    completed_pairs   INT NOT NULL DEFAULT 0,
    failed_pairs      INT NOT NULL DEFAULT 0,

    -- Summary (AI-generated after all findings complete)
    summary_text      TEXT,
    overall_risk      TEXT CHECK (overall_risk IN ('critical','high','medium','low','none')),

    -- Orchestrator session tracking
    orchestrator_session_id TEXT,
    error_message     TEXT,

    initiated_by      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS audit_run_company_idx  ON twin.audit_run (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_run_status_idx   ON twin.audit_run (status);
CREATE INDEX IF NOT EXISTS audit_run_usecase_idx  ON twin.audit_run (use_case_id) WHERE use_case_id IS NOT NULL;


-- ── Audit finding ─────────────────────────────────────────────────────────────
-- One row per use case × regulation pair assessment result.

CREATE TABLE IF NOT EXISTS twin.audit_finding (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_run_id          UUID NOT NULL REFERENCES twin.audit_run(id) ON DELETE CASCADE,
    company_id            UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,

    -- What was assessed
    use_case_id           TEXT NOT NULL,
    use_case_name         TEXT NOT NULL,
    compliance_item_id    UUID REFERENCES twin.compliance_item(id) ON DELETE SET NULL,
    compliance_item_name  TEXT NOT NULL,
    compliance_item_type  TEXT NOT NULL,   -- regulation | policy

    -- Assessment status
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','completed','failed','skipped')),

    -- Risk scoring
    risk_level            TEXT CHECK (risk_level IN ('critical','high','medium','low','none')),
    risk_score            INT,             -- 0-100
    confidence            INT,             -- 0-100 agent confidence in assessment

    -- Structured findings
    applicable_rules      JSONB,           -- list of rules that apply
    gaps                  JSONB,           -- list of identified gaps
    compliant_areas       JSONB,           -- list of areas already compliant
    recommendations       JSONB,           -- list of recommended actions
    summary               TEXT,            -- narrative summary

    -- Agent tracking
    agent_session_id      TEXT,
    tokens_used           INT,
    assessment_duration_ms INT,

    error_message         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_finding_run_idx       ON twin.audit_finding (audit_run_id);
CREATE INDEX IF NOT EXISTS audit_finding_company_idx   ON twin.audit_finding (company_id);
CREATE INDEX IF NOT EXISTS audit_finding_usecase_idx   ON twin.audit_finding (use_case_id);
CREATE INDEX IF NOT EXISTS audit_finding_risk_idx      ON twin.audit_finding (risk_level);
CREATE INDEX IF NOT EXISTS audit_finding_status_idx    ON twin.audit_finding (status);


-- ── Triggers ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TRIGGER audit_run_updated_at
        BEFORE UPDATE ON twin.audit_run
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER audit_finding_updated_at
        BEFORE UPDATE ON twin.audit_finding
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
