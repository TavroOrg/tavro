CREATE TABLE IF NOT EXISTS core.skills (
	tenant_id TEXT NOT NULL,
	company_id TEXT NOT NULL,
	skill_id TEXT,
	name TEXT,
	description TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP,
	tags TEXT[],
	input_modes TEXT[],
	output_modes TEXT[],
	CONSTRAINT chk_skills_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
	CONSTRAINT chk_skills_company_id_present CHECK (company_id IS NOT NULL AND btrim(company_id) <> '')
);
