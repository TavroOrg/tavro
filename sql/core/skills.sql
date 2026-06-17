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
