CREATE TABLE IF NOT EXISTS core.agent_risk_assessments (
	tenant_id TEXT,
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

