CREATE TABLE IF NOT EXISTS core.skills (
	tenant_id TEXT,
	company_id TEXT,
	skill_id TEXT,
	name TEXT,
	description TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP,
	tags TEXT[],
	input_modes TEXT[],
	output_modes TEXT[]
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_skills_tenant_id_present') THEN
        ALTER TABLE core.skills
            ADD CONSTRAINT chk_skills_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'skills: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_skills_company_id_present') THEN
        ALTER TABLE core.skills
            ADD CONSTRAINT chk_skills_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'skills: company_id CHECK skipped — %', SQLERRM;
END $$;
