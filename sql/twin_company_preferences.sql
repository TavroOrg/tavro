-- =============================================================
-- twin.company_preferences — company-wide settings (roadmap scoring
-- weights, node defaults, LLM provider policy) centralized out of
-- localStorage/hardcoded defaults.
-- Auto-run by Docker entrypoint on first container start (runs after
-- tavro_setup_all.sql, which creates twin.company).
-- =============================================================

SET search_path = twin, ag_catalog, public;

CREATE TABLE IF NOT EXISTS twin.company_preferences (
    id                       UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                TEXT,
    company_id               UUID                  NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    priority_weights         JSONB                 NOT NULL DEFAULT '{"BV": 0.55, "TC": 0.20, "RISK": 0.25}',
    risk_weights             JSONB                 NOT NULL DEFAULT '{"data_privacy": 20, "operational": 20, "compliance": 20, "ai_behavioral": 20, "strategic_reputational": 20}',
    default_visibility       twin.visibility_level NOT NULL DEFAULT 'internal',
    default_sensitive        BOOLEAN               NOT NULL DEFAULT false,
    llm_provider_allowlist   JSONB                 NOT NULL DEFAULT '[]',
    default_llm_provider     TEXT,
    risk_review_threshold    DOUBLE PRECISION,
    created_at               TIMESTAMPTZ           NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT company_preferences_company_uidx UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS company_preferences_tenant_idx ON twin.company_preferences (tenant_id);

DO $$ BEGIN
    CREATE TRIGGER company_preferences_updated_at
        BEFORE UPDATE ON twin.company_preferences
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
