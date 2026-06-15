-- Many-to-many junction: AI Model <-> Business Process.
-- Mirrors the ai_use_case_business_processes pure-junction pattern.
CREATE TABLE IF NOT EXISTS core.ai_model_business_processes (
	tenant_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	business_process_id TEXT,
	process_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
