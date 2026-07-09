CREATE TABLE IF NOT EXISTS core.ai_use_cases (
  tenant_id TEXT,
  ai_use_case_id TEXT,
  name TEXT,
  description TEXT,
  proposed_by TEXT,
  owner TEXT,
  function TEXT,
  problem_statement TEXT,
  expected_benefits TEXT,
  priority TEXT,
  status TEXT,
  created_ts timestamp,
  updated_ts timestamp,
  agent_risk_exposure_are decimal(10, 2),
  no_of_associated_agents int,
  inherent_risk_classification TEXT,
  residual_risk_classification TEXT,
  agent_risk_tier_art TEXT,
  blended_risk_score decimal(10, 2),
  inherent_risk_classification_score decimal(10, 2),
  residual_risk_classification_score decimal(10, 2),
  solution_approach TEXT,
  company_id TEXT,
  company_name TEXT,
  assumptions TEXT,
  quantified_financial_benefits TEXT,
  total_financial_impact_summary TEXT,
  implementation_cost_estimate TEXT,
  return_on_investment TEXT,
  risk_considerations TEXT,
  implementation_roadmap TEXT,
  recommendation TEXT,
  executive_summary TEXT,
  business_value_score                  INTEGER CHECK (business_value_score BETWEEN 1 AND 5),
  business_value_override               BOOLEAN DEFAULT FALSE,
  business_value_override_reason        TEXT,
  data_readiness_score                  INTEGER CHECK (data_readiness_score BETWEEN 1 AND 5),
  data_readiness_override               BOOLEAN DEFAULT FALSE,
  data_readiness_override_reason        TEXT,
  technical_complexity_score            INTEGER CHECK (technical_complexity_score BETWEEN 1 AND 5),
  technical_complexity_override         BOOLEAN DEFAULT FALSE,
  technical_complexity_override_reason  TEXT,
  risk_data_privacy_score               INTEGER CHECK (risk_data_privacy_score BETWEEN 1 AND 5),
  risk_operational_score                INTEGER CHECK (risk_operational_score BETWEEN 1 AND 5),
  risk_compliance_score                 INTEGER CHECK (risk_compliance_score BETWEEN 1 AND 5),
  risk_ai_behavioral_score              INTEGER CHECK (risk_ai_behavioral_score BETWEEN 1 AND 5),
  risk_strategic_reputational_score     INTEGER CHECK (risk_strategic_reputational_score BETWEEN 1 AND 5),
  risk_composite_score                  DECIMAL(4, 2),
  priority_score                        DECIMAL(4, 2),
  quadrant                              TEXT CHECK (quadrant IN ('quick_win', 'big_bet', 'fill_in', 'money_pit')),
  time_horizon                          TEXT CHECK (time_horizon IN ('now', 'next', 'later')),
  time_horizon_rationale                TEXT,
  roadmap_approved                      BOOLEAN DEFAULT FALSE,
  scoring_history                       JSONB DEFAULT '[]'::JSONB
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.ai_use_cases VALIDATE CONSTRAINT chk_ai_use_cases_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, ai_use_case_id).
-- The existing ux_core_ai_use_cases UNIQUE (tenant_id, ai_use_case_id) is a
-- separate, stricter business-uniqueness rule (an ai_use_case_id must be
-- unique per tenant regardless of company) and is kept as-is — it is not
-- redundant with this composite key, so a new index is built here.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_ai_use_cases_tenant_id_present'
        ) THEN
            ALTER TABLE core.ai_use_cases
                ADD CONSTRAINT chk_ai_use_cases_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_use_cases: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_ai_use_cases') THEN
            ALTER TABLE core.ai_use_cases
                ADD CONSTRAINT pk_core_ai_use_cases PRIMARY KEY (tenant_id, company_id, ai_use_case_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_use_cases: composite PK skipped — %', SQLERRM;
    END;
END $$;

