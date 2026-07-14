-- zz_ prefix is deliberate: tavro_api/api/migrations/init_tables.py runs
-- every sql/core/*.sql file in plain alphabetical order, and this table's
-- FK target (core.ai_models) must be created first. "ai_model_attachment"
-- sorts before "ai_models" alphabetically ('_' < 's'), so this file is
-- prefixed to force it to run last, after ai_models.sql.
CREATE TABLE IF NOT EXISTS core.ai_model_attachment (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    ai_model_id TEXT NOT NULL,
    category TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ai_model_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_ai_model_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    -- Composite PK for consistency with every other core/twin table,
    -- matching the (tenant_id, company_id, asset_id) pattern.
    CONSTRAINT pk_ai_model_attachment PRIMARY KEY (tenant_id, company_id, id),
    CONSTRAINT fk_ai_model_attachment_ai_model FOREIGN KEY (tenant_id, company_id, ai_model_id) REFERENCES core.ai_models (tenant_id, company_id, ai_model_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_model_attachment_model_idx
ON core.ai_model_attachment (ai_model_id, category, created_at DESC);
