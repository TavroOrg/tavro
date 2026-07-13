CREATE TABLE IF NOT EXISTS core.use_case_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    use_case_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_use_case_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_use_case_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    CONSTRAINT fk_use_case_attachment_use_case FOREIGN KEY (tenant_id, company_id, use_case_id) REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS use_case_attachment_use_case_idx
ON core.use_case_attachment (use_case_id, created_at DESC);
