CREATE TABLE IF NOT EXISTS core.business_integrations (
    integration_id TEXT PRIMARY KEY,
    tenant_id TEXT,
    integration_name TEXT,
    integration_description TEXT,
    capabilities TEXT,
    protocol TEXT,
    endpoint_url TEXT,
    authentication_method TEXT,
    owner TEXT,
    documentation_url TEXT,
    data_sensitivity TEXT,
    rate_limit TEXT,
    availability_status TEXT,
    sla TEXT,
    version TEXT,
    parent_application_id TEXT,
    company_id TEXT,
    company_name TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    business_criticality TEXT,
    emergency_tier TEXT,
    blended_risk_score NUMERIC,
    agent_risk_exposure NUMERIC,
    agent_risk_tier TEXT,
    inherent_risk_classification TEXT,
    residual_risk_classification TEXT,
    inherent_risk_classification_score NUMERIC,
    residual_risk_classification_score NUMERIC,
    num_of_associated_agents INTEGER,
    sensitive BOOLEAN DEFAULT FALSE,
    visibility TEXT DEFAULT 'internal',
    valid_from TIMESTAMP,
    valid_to TIMESTAMP,
    created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.business_integrations VALIDATE CONSTRAINT chk_business_integrations_tenant_id_present;
--
-- Critical #2: NOT converted to a composite PRIMARY KEY. integration_id
-- already has a live foreign key pointing at it
-- (fk_core_agent_business_integrations_integration on core.agent_business_integrations),
-- so replacing the PK would require migrating that FK in the same change.
-- Instead, add the tenant/company scoping as an additional UNIQUE constraint
-- alongside the existing PK — same isolation guarantee, no breaking cascade.
-- Promoting to a full composite PK (with the dependent FK migrated to match)
-- is tracked as a coordinated follow-up.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_integrations_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_integrations
                ADD CONSTRAINT chk_business_integrations_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_integrations: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_core_business_integrations_tenant_company') THEN
            ALTER TABLE core.business_integrations
                ADD CONSTRAINT ux_core_business_integrations_tenant_company UNIQUE (tenant_id, company_id, integration_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_integrations: composite UNIQUE skipped — %', SQLERRM;
    END;
END $$;
