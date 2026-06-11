-- =============================================================
-- Migration: 005_add_ai_model_app_process_links
-- Feature:   Many-to-many mapping AI Model <-> Business Application
--            and AI Model <-> Business Process.
--
--   core.ai_model_business_applications -> pure junction
--   core.ai_model_business_processes    -> pure junction
--       (mirror core.ai_use_case_business_applications / _processes)
--
-- PURELY ADDITIVE: only creates new tables, unique indexes, and foreign keys.
-- No existing table or column is altered or dropped — no data-migration or
-- backward-compatibility concerns. Idempotent and safe to apply independently.
-- After applying, RESTART the API.
--
-- Apply:   psql -U tavro -d tavro -f 005_add_ai_model_app_process_links.sql
-- Rollback: see bottom of file.
-- =============================================================

BEGIN;

-- ── 1. AI Model <-> Business Application ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.ai_model_business_applications (
    tenant_id               TEXT,
    ai_model_id             TEXT,
    ai_model_name           TEXT,
    business_application_id TEXT,
    application_name        TEXT,
    created_ts              TIMESTAMP,
    updated_ts              TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_model_business_applications
    ON core.ai_model_business_applications (ai_model_id, business_application_id);

-- ── 2. AI Model <-> Business Process ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.ai_model_business_processes (
    tenant_id           TEXT,
    ai_model_id         TEXT,
    ai_model_name       TEXT,
    business_process_id TEXT,
    process_name        TEXT,
    created_ts          TIMESTAMP,
    updated_ts          TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_model_business_processes
    ON core.ai_model_business_processes (ai_model_id, business_process_id);

-- ── 3. Foreign keys (cascade on parent delete) ───────────────────────────────
DO $$
BEGIN
    IF to_regclass('core.ai_models') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_core_ai_model_business_applications_ai_model') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT fk_core_ai_model_business_applications_ai_model
            FOREIGN KEY (ai_model_id) REFERENCES core.ai_models (ai_model_id) ON DELETE CASCADE;
    END IF;

    IF to_regclass('core.business_applications') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_core_ai_model_business_applications_application') THEN
        ALTER TABLE core.ai_model_business_applications
            ADD CONSTRAINT fk_core_ai_model_business_applications_application
            FOREIGN KEY (business_application_id) REFERENCES core.business_applications (business_application_id) ON DELETE CASCADE;
    END IF;

    IF to_regclass('core.ai_models') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_core_ai_model_business_processes_ai_model') THEN
        ALTER TABLE core.ai_model_business_processes
            ADD CONSTRAINT fk_core_ai_model_business_processes_ai_model
            FOREIGN KEY (ai_model_id) REFERENCES core.ai_models (ai_model_id) ON DELETE CASCADE;
    END IF;

    IF to_regclass('core.business_processes') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_core_ai_model_business_processes_process') THEN
        ALTER TABLE core.ai_model_business_processes
            ADD CONSTRAINT fk_core_ai_model_business_processes_process
            FOREIGN KEY (business_process_id) REFERENCES core.business_processes (business_process_id) ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;


-- =============================================================
-- ROLLBACK (manual)
-- =============================================================
--
-- BEGIN;
-- DROP TABLE IF EXISTS core.ai_model_business_applications;  -- drops FKs + index
-- DROP TABLE IF EXISTS core.ai_model_business_processes;     -- drops FKs + index
-- COMMIT;
