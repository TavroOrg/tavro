-- =============================================================
-- Migration: 003_add_ai_models
-- Feature:   AI Models catalog + pure agent<->model junction.
--
--   core.ai_models             -> catalog (all descriptive model attributes)
--   core.agent_ai_models       -> pure junction (mirrors core.agent_ai_use_cases)
--   public.ai_model_attachment -> per-model file uploads (per category)
--
-- This migration also RESHAPES the existing core.agent_ai_models table:
-- its descriptive columns (owner, department_executive, description,
-- model_provider, model_version, model_type, is_primary_model, usage_role)
-- move out to the catalog, leaving a clean link table. Existing rows are
-- preserved: a deterministic ai_model_id is derived from model_name, the
-- descriptive values are copied into core.ai_models, then the extra columns
-- are dropped.
--
-- Idempotent and safe to re-run. After applying, RESTART the API.
--
-- Apply:   psql -U tavro -d tavro -f 003_add_ai_models.sql
-- Rollback: see bottom of file.
-- =============================================================

BEGIN;

-- ── 1. Catalog table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.ai_models (
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
    use_case_value_drivers TEXT,
    user_types TEXT,
    decision_type TEXT,
    automation_level TEXT,
    regulatory_mapping TEXT,
    consumer_impact TEXT,
    risk_tier_materiality TEXT,
    model_type TEXT,
    technique_class TEXT,
    learning_approach TEXT,
    update_frequency TEXT,
    input_variable_count TEXT,
    data_join_method TEXT,
    statistical_assumptions TEXT,
    documented_constraints TEXT,
    stability_window TEXT,
    last_validation_date TEXT,
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
    no_of_associated_agents INTEGER,
    agent_internal_id TEXT,
    created_ts TIMESTAMP,
    updated_ts TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_models
    ON core.ai_models (ai_model_id);

-- ── 2. Junction reshape ───────────────────────────────────────────────────────
-- Ensure the columns the link table needs exist.
ALTER TABLE core.agent_ai_models ADD COLUMN IF NOT EXISTS ai_model_id TEXT;
ALTER TABLE core.agent_ai_models ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE core.agent_ai_models ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Backfill a deterministic ai_model_id from model_name for legacy rows that
-- were ingested with a NULL id (so they map to a stable catalog entry).
UPDATE core.agent_ai_models
SET ai_model_id = md5(lower(trim(model_name)))
WHERE COALESCE(ai_model_id, '') = ''
  AND COALESCE(model_name, '') <> '';

-- Copy descriptive values from the junction's embedded columns into the catalog
-- (only if those columns still exist on this database).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'agent_ai_models' AND column_name = 'owner'
    ) THEN
        EXECUTE '
            INSERT INTO core.ai_models (
                ai_model_id, model_name, owner, department_executive, description,
                no_of_associated_agents, created_ts, updated_ts
            )
            SELECT DISTINCT ON (j.ai_model_id)
                j.ai_model_id, j.model_name, j.owner, j.department_executive, j.description,
                0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM core.agent_ai_models j
            WHERE COALESCE(j.ai_model_id, '''') <> ''''
            ORDER BY j.ai_model_id, j.updated_ts DESC NULLS LAST
            ON CONFLICT (ai_model_id) DO UPDATE SET
                model_name           = COALESCE(NULLIF(EXCLUDED.model_name, ''''), core.ai_models.model_name),
                owner                = COALESCE(EXCLUDED.owner, core.ai_models.owner),
                department_executive = COALESCE(EXCLUDED.department_executive, core.ai_models.department_executive),
                description          = COALESCE(EXCLUDED.description, core.ai_models.description),
                updated_ts           = CURRENT_TIMESTAMP
        ';
    END IF;
END $$;

-- Drop the descriptive columns now living in the catalog.
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS model_provider;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS model_version;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS model_type;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS is_primary_model;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS usage_role;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS owner;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS department_executive;
ALTER TABLE core.agent_ai_models DROP COLUMN IF EXISTS description;

-- De-duplicate before applying the new unique key.
DELETE FROM core.agent_ai_models a
USING core.agent_ai_models b
WHERE a.ctid < b.ctid
  AND COALESCE(a.agent_internal_id, '') = COALESCE(b.agent_internal_id, '')
  AND COALESCE(a.ai_model_id, '')       = COALESCE(b.ai_model_id, '');

DROP INDEX IF EXISTS core.ux_core_agent_ai_models;
CREATE UNIQUE INDEX ux_core_agent_ai_models
    ON core.agent_ai_models (agent_internal_id, ai_model_id);

-- ── 3. Attachment table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_model_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_model_id TEXT NOT NULL,
    category TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_model_attachment_model_idx
    ON public.ai_model_attachment (ai_model_id, category, created_at DESC);

COMMIT;


-- =============================================================
-- ROLLBACK (manual; destructive — the dropped junction columns
-- cannot be restored with their original per-row values)
-- =============================================================
--
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_model_attachment;
-- ALTER TABLE core.agent_ai_models
--     ADD COLUMN IF NOT EXISTS model_provider TEXT,
--     ADD COLUMN IF NOT EXISTS model_version TEXT,
--     ADD COLUMN IF NOT EXISTS model_type TEXT,
--     ADD COLUMN IF NOT EXISTS is_primary_model BOOLEAN,
--     ADD COLUMN IF NOT EXISTS usage_role TEXT,
--     ADD COLUMN IF NOT EXISTS owner TEXT,
--     ADD COLUMN IF NOT EXISTS department_executive TEXT,
--     ADD COLUMN IF NOT EXISTS description TEXT;
-- -- (Optional) repopulate descriptive columns from the catalog:
-- UPDATE core.agent_ai_models j SET
--     owner = m.owner, department_executive = m.department_executive, description = m.description
-- FROM core.ai_models m WHERE m.ai_model_id = j.ai_model_id;
-- DROP INDEX IF EXISTS core.ux_core_agent_ai_models;
-- CREATE UNIQUE INDEX ux_core_agent_ai_models ON core.agent_ai_models (agent_internal_id, model_name);
-- DROP INDEX IF EXISTS core.ux_core_ai_models;
-- DROP TABLE IF EXISTS core.ai_models;
-- COMMIT;
