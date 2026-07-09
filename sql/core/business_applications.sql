CREATE TABLE IF NOT EXISTS core.business_applications (
    tenant_id TEXT,
    business_application_id TEXT,
    application_name TEXT,
    emergency_tier TEXT,
    business_owner TEXT,
    application_portfolio_manager TEXT,
    vendor_name TEXT,
    business_criticality TEXT,
    it_application_owner TEXT,
    application_description TEXT,
    agent_risk_exposure DOUBLE PRECISION,
    num_of_associated_agents INTEGER,
    inherent_risk_classification TEXT,
    residual_risk_classification TEXT,
    agent_risk_tier TEXT,
    blended_risk_score DOUBLE PRECISION,
    inherent_risk_classification_score DOUBLE PRECISION,
    residual_risk_classification_score DOUBLE PRECISION,
    embedded_ai TEXT,
    opt_out_option TEXT,
    privacy_policy_url TEXT,
    data_excluded_from_ai_training TEXT,
    vendor_description TEXT,
    current_installed_version TEXT,
    is_current_version_supported TEXT,
    latest_released_version TEXT,
    latest_release_date TIMESTAMP,
    latest_release_documentation_link TEXT,
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
--   ALTER TABLE core.business_applications VALIDATE CONSTRAINT chk_business_applications_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, business_application_id).
-- ux_core_business_applications (added in zz_agent_upsert_unique_indexes.sql)
-- already covers this exact column set, so it is reused in place via
-- "USING INDEX" instead of building a duplicate index.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_applications_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_applications
                ADD CONSTRAINT chk_business_applications_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_applications: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_business_applications') THEN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_core_business_applications') THEN
                ALTER TABLE core.business_applications
                    ADD CONSTRAINT pk_core_business_applications PRIMARY KEY USING INDEX ux_core_business_applications;
            ELSE
                ALTER TABLE core.business_applications
                    ADD CONSTRAINT pk_core_business_applications PRIMARY KEY (tenant_id, company_id, business_application_id);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_applications: composite PK skipped — %', SQLERRM;
    END;
END $$;
