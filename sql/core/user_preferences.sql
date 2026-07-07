CREATE TABLE IF NOT EXISTS twin.user_preferences (
    user_id             TEXT        PRIMARY KEY,
    tenant_id           TEXT,
    default_company_id  UUID        REFERENCES twin.company (id) ON DELETE SET NULL,
    theme               TEXT        NOT NULL DEFAULT 'system',
    llm_provider        TEXT,
    llm_model           TEXT,
    llm_byok_type       TEXT,
    llm_byok_base_url   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_preferences_tenant_idx ON twin.user_preferences (tenant_id);

DO $$ BEGIN
    CREATE TRIGGER user_preferences_updated_at
        BEFORE UPDATE ON twin.user_preferences
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
