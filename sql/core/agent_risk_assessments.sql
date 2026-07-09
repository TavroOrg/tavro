CREATE TABLE IF NOT EXISTS core.agent_risk_assessments (
	tenant_id TEXT,
	company_id TEXT,
	risk_assessment_id TEXT,
	agent_id TEXT,
	assessment_name TEXT,
	assessor_name TEXT,
	assessment_ts timestamp,
	blended_risk_score decimal(10, 2),
	blended_risk_class TEXT,
	aivss_score decimal(10, 2),
	aivss_class TEXT,
	regulatory_risk_score decimal(10, 2),
	regulatory_risk_class TEXT,
	state_name TEXT,
	record_hash TEXT,
	valid_from_ts timestamp,
	valid_to_ts timestamp,
	is_current boolean,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT,
	summary TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents. RESTRICT, not
-- CASCADE — risk history should block accidental agent deletion, not
-- silently vanish with it. NOT VALID: safe on a live table with existing
-- data; validate later with
-- ALTER TABLE core.agent_risk_assessments VALIDATE CONSTRAINT fk_agent_risk_assessments_agent;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_risk_assessments_agent') THEN
        ALTER TABLE core.agent_risk_assessments
            ADD CONSTRAINT fk_agent_risk_assessments_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_risk_assessments: composite FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_risk_assessments_tenant_id_present') THEN
        ALTER TABLE core.agent_risk_assessments
            ADD CONSTRAINT chk_agent_risk_assessments_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_risk_assessments: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_risk_assessments_company_id_present') THEN
        ALTER TABLE core.agent_risk_assessments
            ADD CONSTRAINT chk_agent_risk_assessments_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_risk_assessments: company_id CHECK skipped — %', SQLERRM;
END $$;

