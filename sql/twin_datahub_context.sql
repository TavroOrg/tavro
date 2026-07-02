-- =============================================================
-- twin.datahub_context — pgvector store for DataHub metadata exports
-- Auto-run by Docker entrypoint on first container start (runs after
-- tavro_setup_all.sql, which creates twin.company / pgvector extension).
-- =============================================================

SET search_path = twin, ag_catalog, public;

CREATE TABLE IF NOT EXISTS twin.datahub_context (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID        REFERENCES twin.company (id) ON DELETE CASCADE,
    scope        TEXT        NOT NULL DEFAULT 'global_template',
    urn          TEXT        NOT NULL,
    entity_type  TEXT,
    label        TEXT        NOT NULL,
    chunk_text   TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}',
    embedding    VECTOR(384)  NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT datahub_context_scope_company_urn_uidx UNIQUE NULLS NOT DISTINCT (scope, company_id, urn)
);

CREATE INDEX IF NOT EXISTS datahub_context_embedding_idx ON twin.datahub_context
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS datahub_context_company_idx ON twin.datahub_context (company_id);
CREATE INDEX IF NOT EXISTS datahub_context_scope_idx ON twin.datahub_context (scope);

DO $$ BEGIN
    CREATE TRIGGER datahub_context_updated_at
        BEFORE UPDATE ON twin.datahub_context
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
