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

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
-- NOTE: this table has no column linking it to an agent at all, so it was
-- deliberately excluded from the High #2 FK rollout — see audit_db/README.md.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_resources_tenant_id_present') THEN
        ALTER TABLE core.agent_resources
            ADD CONSTRAINT chk_agent_resources_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_resources: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_resources_company_id_present') THEN
        ALTER TABLE core.agent_resources
            ADD CONSTRAINT chk_agent_resources_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_resources: company_id CHECK skipped — %', SQLERRM;
END $$;
