CREATE TABLE IF NOT EXISTS core.business_processes (
    tenant_id TEXT,
    business_process_id TEXT,
    process_number TEXT,
    process_name TEXT,
    process_description TEXT,
    parent_process_id TEXT,
    owner TEXT,
    stakeholders TEXT,
    operators TEXT,
    business_criticality TEXT,
    reputational_impact TEXT,
    num_of_associated_agents INTEGER,
    agent_risk_tier TEXT,
    residual_risk_classification TEXT,
    inherent_risk_classification TEXT,
    financial_impact TEXT,
    regulatory_impact TEXT,
    agent_risk_exposure DOUBLE PRECISION,
    blended_risk_score DOUBLE PRECISION,
    residual_risk_classification_score DOUBLE PRECISION,
    inherent_risk_classification_score DOUBLE PRECISION,
    sla TEXT,
    process_health_state TEXT,
    company_id TEXT,
    company_name TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    sensitive BOOLEAN DEFAULT FALSE,
    visibility TEXT DEFAULT 'internal',
    valid_from TIMESTAMP,
    valid_to TIMESTAMP,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.business_processes VALIDATE CONSTRAINT chk_business_processes_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, business_process_id).
-- ux_core_business_processes (added in zz_agent_upsert_unique_indexes.sql)
-- already covers this exact column set, so it is reused in place via
-- "USING INDEX" instead of building a duplicate index.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_processes_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_processes
                ADD CONSTRAINT chk_business_processes_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_processes: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_business_processes') THEN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_core_business_processes') THEN
                ALTER TABLE core.business_processes
                    ADD CONSTRAINT pk_core_business_processes PRIMARY KEY USING INDEX ux_core_business_processes;
            ELSE
                ALTER TABLE core.business_processes
                    ADD CONSTRAINT pk_core_business_processes PRIMARY KEY (tenant_id, company_id, business_process_id);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_processes: composite PK skipped — %', SQLERRM;
    END;
END $$;
