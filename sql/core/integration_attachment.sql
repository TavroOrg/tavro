CREATE TABLE IF NOT EXISTS core.integration_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_integration_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_integration_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    CONSTRAINT fk_integration_attachment_integration FOREIGN KEY (tenant_id, company_id, integration_id) REFERENCES core.business_integrations (tenant_id, company_id, integration_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS integration_attachment_integration_id_idx
ON core.integration_attachment (integration_id, created_at DESC);
