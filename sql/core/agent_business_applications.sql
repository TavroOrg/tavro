CREATE TABLE IF NOT EXISTS core.agent_business_applications (
	tenant_id TEXT,
	company_id TEXT,
	business_application_id TEXT,
	agent_id TEXT,
	application_name TEXT,
	application_type TEXT,
	owning_team TEXT,
	business_owner TEXT,
	environment_name TEXT,
	criticality TEXT,
	integration_role TEXT,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE — this
-- association is meaningless without the agent) and composite FK to
-- core.business_applications (RESTRICT — don't silently vanish a shared
-- catalog entity while agents still reference it; uses the composite PK
-- added in Critical #2). NOT VALID: safe on a live table with existing
-- data; validate later with
-- ALTER TABLE core.agent_business_applications VALIDATE CONSTRAINT fk_agent_business_applications_agent;
-- ALTER TABLE core.agent_business_applications VALIDATE CONSTRAINT fk_agent_business_applications_application;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_applications_agent') THEN
        ALTER TABLE core.agent_business_applications
            ADD CONSTRAINT fk_agent_business_applications_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_applications->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_applications_application') THEN
        ALTER TABLE core.agent_business_applications
            ADD CONSTRAINT fk_agent_business_applications_application
            FOREIGN KEY (tenant_id, company_id, business_application_id)
            REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_business_applications->business_applications FK skipped — %', SQLERRM;
END $$;

