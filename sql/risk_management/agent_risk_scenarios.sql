CREATE TABLE IF NOT EXISTS risk_management.agent_risk_scenarios (
  tenant_id TEXT,
  company_id TEXT,
  risk_scenario_id TEXT,
  assessment_id TEXT,
  attack_complexity_ac TEXT,
  attack_requirements_at TEXT,
  attack_vector_av TEXT,
  cvss_4_0_vector TEXT,
  agentic_ai_core_security_risks TEXT,
  privileges_required_pr TEXT,
  subsequent_system_availability_sa TEXT,
  subsequent_system_confidentiality_sc TEXT,
  subsequent_system_integrity_si TEXT,
  created_ts TIMESTAMP,
  updated_ts TIMESTAMP,
  user_interaction_ui TEXT,
  vulnerable_system_availability_va TEXT,
  vulnerable_system_confidentiality_vc TEXT,
  vulnerable_system_integrity_vi TEXT,
  created_by TEXT,
  updated_by TEXT,
  threat_multiplier DECIMAL(10, 2),
  cvss_score DECIMAL(10, 2),
  aivss_score DECIMAL(10, 2)
);

-- High #2 (audit_db/README.md): FK to risk_management.agent_risk_assessment
-- (CASCADE — a scenario has no meaning without its assessment).
-- Single-column: risk_management was not part of the Critical #2 composite
-- rollout. NOT VALID: safe on a live table with existing data; validate
-- later with
-- ALTER TABLE risk_management.agent_risk_scenarios VALIDATE CONSTRAINT fk_agent_risk_scenarios_assessment;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_risk_scenarios_assessment') THEN
        ALTER TABLE risk_management.agent_risk_scenarios
            ADD CONSTRAINT fk_agent_risk_scenarios_assessment
            FOREIGN KEY (assessment_id) REFERENCES risk_management.agent_risk_assessment (assessment_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_risk_scenarios->agent_risk_assessment FK skipped — %', SQLERRM;
END $$;

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id or company_id, without requiring historic data to be clean
-- first (NOT VALID).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_risk_scenarios_tenant_id_present') THEN
        ALTER TABLE risk_management.agent_risk_scenarios
            ADD CONSTRAINT chk_agent_risk_scenarios_tenant_id_present
            CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'risk_management.agent_risk_scenarios: tenant_id CHECK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_risk_scenarios_company_id_present') THEN
        ALTER TABLE risk_management.agent_risk_scenarios
            ADD CONSTRAINT chk_agent_risk_scenarios_company_id_present
            CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'risk_management.agent_risk_scenarios: company_id CHECK skipped — %', SQLERRM;
END $$;