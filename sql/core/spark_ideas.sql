CREATE TABLE IF NOT EXISTS core.spark_ideas (
    idea_id           TEXT PRIMARY KEY,
    company_id        TEXT NOT NULL,
    tenant_id         TEXT,
    title             TEXT NOT NULL,
    description       TEXT,
    rationale         TEXT,
    signal_type       TEXT,
    signal_label      TEXT,
    target_dimensions TEXT[],
    target_nodes      JSONB,
    complexity        TEXT,
    estimated_impact  TEXT,
    similar_agents    JSONB,
    user_reaction     TEXT,
    popularity_score  INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.spark_ideas VALIDATE CONSTRAINT chk_spark_ideas_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, idea_id),
-- replacing the single-column idea_id PK. No foreign key currently targets
-- core.spark_ideas, so this is safe to widen without a coordinated migration.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_spark_ideas_tenant_id_present'
        ) THEN
            ALTER TABLE core.spark_ideas
                ADD CONSTRAINT chk_spark_ideas_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.spark_ideas: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_spark_ideas') THEN
            ALTER TABLE core.spark_ideas DROP CONSTRAINT IF EXISTS spark_ideas_pkey;
            ALTER TABLE core.spark_ideas
                ADD CONSTRAINT pk_core_spark_ideas PRIMARY KEY (tenant_id, company_id, idea_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.spark_ideas: composite PK skipped — %', SQLERRM;
    END;
END $$;

