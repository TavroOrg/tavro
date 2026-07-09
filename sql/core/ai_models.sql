CREATE TABLE IF NOT EXISTS core.ai_models (
	-- Identification & Accountability
	tenant_id TEXT,
	ai_model_id TEXT,
	model_name TEXT,
	owner TEXT,
	description TEXT,
	department_executive TEXT,
	business_functions TEXT,
	vendor_or_inhouse TEXT,
	provider TEXT,
	status TEXT,
	parent_model_id TEXT,
	version_number TEXT,

	-- Intended Use & Decision Impact
	use_case_value_drivers TEXT,
	user_types TEXT,
	decision_type TEXT,
	automation_level TEXT,
	regulatory_mapping TEXT,
	consumer_impact TEXT,
	risk_tier_materiality TEXT,

	-- Model Construct
	model_type TEXT,
	technique_class TEXT,
	learning_approach TEXT,
	update_frequency TEXT,
	input_variable_count TEXT,
	data_join_method TEXT,
	statistical_assumptions TEXT,
	documented_constraints TEXT,
	stability_window TEXT,

	-- Model Validation
	last_validation_date TEXT,

	-- Model Recertification
	recert_use_case_same TEXT,
	recert_use_case_changed TEXT,
	recert_inputs_same TEXT,
	recert_inputs_changed TEXT,
	recert_outputs_same TEXT,
	recert_outputs_changed TEXT,
	recert_users_same TEXT,
	recert_users_changed TEXT,
	recert_processing_same TEXT,
	recert_processing_changed TEXT,
	recert_training_completed TEXT,
	recert_risk_assessment_done TEXT,

	-- ARE / rollup
	business_criticality TEXT,
	emergency_tier TEXT,
	blended_risk_score NUMERIC,
	agent_risk_exposure NUMERIC,
	agent_risk_tier TEXT,
	inherent_risk_classification TEXT,
	residual_risk_classification TEXT,
	inherent_risk_classification_score NUMERIC,
	residual_risk_classification_score NUMERIC,
	no_of_associated_agents INTEGER,
	agent_internal_id TEXT,
	company_id TEXT,
	company_name TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.ai_models VALIDATE CONSTRAINT chk_ai_models_tenant_id_present;
--
-- Critical #2: NOT converted to a composite PRIMARY KEY. ai_model_id already
-- has four live foreign keys pointing at it (fk_core_agent_ai_models_ai_model,
-- fk_core_ai_model_ai_use_cases_ai_model, fk_core_ai_model_business_applications_ai_model,
-- fk_core_ai_model_business_processes_ai_model), so replacing the key would
-- require migrating all four in the same change. Instead, add the
-- tenant/company scoping as an additional UNIQUE constraint alongside the
-- existing ux_core_ai_models index — same isolation guarantee, no breaking
-- cascade. Promoting to a full composite PK (with dependent FKs migrated to
-- match) is tracked as a coordinated follow-up.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_ai_models_tenant_id_present'
        ) THEN
            ALTER TABLE core.ai_models
                ADD CONSTRAINT chk_ai_models_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_models: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_core_ai_models_tenant_company') THEN
            ALTER TABLE core.ai_models
                ADD CONSTRAINT ux_core_ai_models_tenant_company UNIQUE (tenant_id, company_id, ai_model_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_models: composite UNIQUE skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_ai_models_company_id_present'
        ) THEN
            ALTER TABLE core.ai_models
                ADD CONSTRAINT chk_ai_models_company_id_present
                CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_models: company_id CHECK skipped — %', SQLERRM;
    END;
END $$;
