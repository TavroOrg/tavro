CREATE TABLE IF NOT EXISTS core.ai_model_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    CONSTRAINT fk_ai_model_attachment_ai_model FOREIGN KEY (tenant_id, company_id, ai_model_id) REFERENCES core.ai_models (tenant_id, company_id, ai_model_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_model_attachment_model_idx
ON core.ai_model_attachment (ai_model_id, category, created_at DESC);
