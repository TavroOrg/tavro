CREATE TABLE IF NOT EXISTS curated.agent_360 (
    tenant_id TEXT,
    agent_id TEXT,
    agent_name TEXT,
    agent_description TEXT,
    autonomy_level TEXT,
    memory_type TEXT,
    reasoning_model TEXT,
    tool_count bigint,
    data_source_count bigint,
    business_application_count bigint,
    business_process_count bigint,
    ai_model_count bigint,
    primary_ai_model_name TEXT,
    primary_ai_model_provider TEXT,
    contains_pii boolean,
    contains_phi boolean,
    contains_pci boolean,
    latest_risk_score decimal(10, 2),
    latest_risk_class TEXT,
    latest_event_status TEXT,
    snapshot_ts timestamp,
    agent_internal_id TEXT,
    summary TEXT,
    company_id TEXT,
    company_name TEXT,
    agent_type TEXT DEFAULT 'Config-driven'
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_360_tenant_id_present') THEN
        ALTER TABLE curated.agent_360
            ADD CONSTRAINT chk_agent_360_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'curated.agent_360: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_360_company_id_present') THEN
        ALTER TABLE curated.agent_360
            ADD CONSTRAINT chk_agent_360_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'curated.agent_360: company_id CHECK skipped — %', SQLERRM;
END $$;

