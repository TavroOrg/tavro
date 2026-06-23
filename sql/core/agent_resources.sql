CREATE TABLE IF NOT EXISTS core.agent_resources (
    tenant_id TEXT,
    company_id TEXT,
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
    updated_ts timestamp
);
