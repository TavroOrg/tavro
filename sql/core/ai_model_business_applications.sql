-- Many-to-many junction: AI Model <-> Business Application.
-- Mirrors the ai_use_case_business_applications pure-junction pattern.
CREATE TABLE IF NOT EXISTS core.ai_model_business_applications (
	tenant_id TEXT,
	ai_model_id TEXT,
	ai_model_name TEXT,
	business_application_id TEXT,
	application_name TEXT,
	created_ts timestamp,
	updated_ts timestamp
);
