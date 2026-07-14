CREATE TABLE IF NOT EXISTS core.agent_attachment (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    agent_source_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_agent_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_agent_attachment_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> ''),
    -- Composite PK for consistency with every other core/twin table.
    -- No FK to core.agents: agent_source_id is the stable business key,
    -- not unique under SCD2 versioning (multiple agent versions can share
    -- one), and platform-created agents can leave it NULL entirely — it
    -- cannot be a reliable FK target. See audit_db/04_high_composite_foreign_keys.sql
    -- for the same reasoning.
    CONSTRAINT pk_agent_attachment PRIMARY KEY (tenant_id, company_id, id)
);

CREATE INDEX IF NOT EXISTS agent_attachment_agent_source_id_idx
ON core.agent_attachment (agent_source_id, created_at DESC);
