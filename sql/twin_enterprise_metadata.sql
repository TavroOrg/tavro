-- =============================================================
-- twin.enterprise_metadata — pgvector store for admin-uploaded CSV files
-- (Digital Twin admin page). One row per source-CSV row; a file is
-- vectorized once — re-uploading an already-processed file is rejected
-- by the API rather than replacing or appending rows.
-- Auto-run by Docker entrypoint on first container start (runs after
-- tavro_setup_all.sql, which creates the twin schema + pgvector extension).
-- =============================================================

SET search_path = twin, ag_catalog, public;

CREATE TABLE IF NOT EXISTS twin.enterprise_metadata (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    TEXT        NOT NULL,
    company_id   TEXT,
    file_name    TEXT        NOT NULL,
    row_index    INTEGER     NOT NULL,
    chunk_text   TEXT        NOT NULL,
    row_data     JSONB       NOT NULL DEFAULT '{}',
    embedding    VECTOR(384) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT enterprise_metadata_file_row_uidx UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, file_name, row_index)
);

-- Optional typed-metadata columns (design-doc alignment). Populated from the
-- uploaded CSV when it has a matching column (case-insensitive); left NULL/
-- default otherwise, so existing generic uploads are unaffected.
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS metadata_type       TEXT;
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS source_system       TEXT;
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS namespace           TEXT;
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS label               TEXT;
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS description         TEXT;
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS structured_metadata JSONB   NOT NULL DEFAULT '{}';
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS tags                TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE twin.enterprise_metadata ADD COLUMN IF NOT EXISTS is_sensitive        BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS enterprise_metadata_embedding_idx ON twin.enterprise_metadata
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS enterprise_metadata_file_idx ON twin.enterprise_metadata (tenant_id, company_id, file_name);
