CREATE TABLE IF NOT EXISTS core.issues (
	tenant_id TEXT,
	issue_id TEXT,
	issue_name TEXT,
	reported_by TEXT,
	reported_date TIMESTAMP,
	reported_department TEXT,
	description TEXT,
	assigned_to TEXT,
	practice_area TEXT,
	due_date TIMESTAMP,
	mitigation_state TEXT,
	line_of_defense TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);

