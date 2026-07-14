CREATE TABLE IF NOT EXISTS core.process_attachment (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    process_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_process_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_process_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    CONSTRAINT pk_process_attachment PRIMARY KEY (tenant_id, company_id, id),
    CONSTRAINT fk_process_attachment_process FOREIGN KEY (tenant_id, company_id, process_id) REFERENCES core.business_processes (tenant_id, company_id, business_process_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS process_attachment_process_id_idx
ON core.process_attachment (process_id, created_at DESC);
