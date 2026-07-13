CREATE TABLE IF NOT EXISTS core.application_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_application_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_application_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    CONSTRAINT fk_application_attachment_application FOREIGN KEY (tenant_id, company_id, application_id) REFERENCES core.business_applications (tenant_id, company_id, business_application_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS application_attachment_application_id_idx
ON core.application_attachment (application_id, created_at DESC);
