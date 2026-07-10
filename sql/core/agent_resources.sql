CREATE TABLE IF NOT EXISTS core.agent_resources (
    tenant_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    identifier TEXT,
    mcp_server_id TEXT,
    name TEXT,
    description TEXT,
    uri_template TEXT,
    mime_type TEXT,
    type TEXT,
    tags TEXT,
    version TEXT,
    created_ts timestamp,
    updated_ts timestamp,
    CONSTRAINT chk_agent_resources_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT chk_agent_resources_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
