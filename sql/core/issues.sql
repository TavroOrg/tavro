CREATE TABLE IF NOT EXISTS core.issues (
	tenant_id TEXT,
	identifier TEXT,
	title TEXT,
	description TEXT,
	issue_type TEXT,
	severity TEXT,
	source TEXT,
	detected_at TIMESTAMP,
	resolved_at TIMESTAMP,
	status TEXT,
	resolution_notes TEXT,
	assignee TEXT,
	owner TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);
