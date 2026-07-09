-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- Implements Critical #1 and #2 from audit_db/README.md:
--   1. Enforce tenant_id presence (Zitadel-issued, fetched by the app —
--      not a value Postgres generates, so this only guards presence/format)
--   2. Promote composite (tenant_id, company_id, <asset_id>) keys to
--      PRIMARY KEY wherever that is safe without breaking a live FK
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - tenant_id CHECK constraints are added NOT VALID: they block new
--     violating INSERT/UPDATE immediately but do NOT scan or fail against
--     existing rows at creation time, so no downtime and no risk of the
--     ALTER itself failing because of pre-existing bad data.
--   - Composite PRIMARY KEY / UNIQUE additions DO scan the table and WILL
--     fail if any existing row has a NULL tenant_id/company_id/asset_id, or
--     a duplicate combination. Each one below is wrapped in its own
--     BEGIN/EXCEPTION block, so a table that isn't ready yet logs a NOTICE
--     and is skipped — it will NOT abort the rest of this script.
--   - Idempotent: safe to re-run. Already-applied constraints are detected
--     via pg_constraint and skipped.
--
-- BEFORE RUNNING:
--   1. Run check_null_tenant_across_db.sql and check_null_company_id_across_db.sql
--      in this same folder first, to know which tables (if any) will be
--      skipped below due to existing NULL data.
--   2. Take this action during a low-traffic window even though the
--      operations are individually safe — ADD CONSTRAINT PRIMARY KEY builds
--      its backing index under a table-level lock (see PRODUCTION NOTE
--      below for large tables).
--
-- PRODUCTION NOTE — large tables:
-- CREATE INDEX CONCURRENTLY cannot run inside a DO block's implicit
-- transaction. If any of the tables below already hold significant
-- production volume, build the unique index out-of-band FIRST, as its own
-- statement, outside any transaction:
--   CREATE UNIQUE INDEX CONCURRENTLY ux_pending_<table>
--       ON <schema>.<table> (tenant_id, company_id, <asset_id>);
-- Re-running this script afterwards will detect a same-shape index does not
-- exist under the exact expected name and will attempt to build one inline —
-- so if you pre-build one, name it to match what each block below checks for
-- (ux_core_business_applications / ux_core_business_processes are reused
-- automatically; for the others, pre-build under the final constraint name
-- and this script's "already exists" check will skip cleanly).
--
-- AFTER RUNNING — promoting NOT VALID checks to fully validated:
-- Once check_null_tenant_across_db.sql reports zero violations for a table,
-- run (safe on a live table — takes a lightweight lock, not exclusive):
--   ALTER TABLE core.agents                 VALIDATE CONSTRAINT chk_agents_tenant_id_present;
--   ALTER TABLE core.business_applications  VALIDATE CONSTRAINT chk_business_applications_tenant_id_present;
--   ALTER TABLE core.business_processes     VALIDATE CONSTRAINT chk_business_processes_tenant_id_present;
--   ALTER TABLE core.ai_use_cases           VALIDATE CONSTRAINT chk_ai_use_cases_tenant_id_present;
--   ALTER TABLE core.issues                 VALIDATE CONSTRAINT chk_issues_tenant_id_present;
--   ALTER TABLE core.spark_ideas            VALIDATE CONSTRAINT chk_spark_ideas_tenant_id_present;
--   ALTER TABLE core.business_integrations  VALIDATE CONSTRAINT chk_business_integrations_tenant_id_present;
--   ALTER TABLE core.ai_models              VALIDATE CONSTRAINT chk_ai_models_tenant_id_present;
--
-- SCOPE NOTE: this first pass covers the 8 "direct owner" tables named in
-- README Critical #2 (agents, business_applications, business_processes,
-- ai_use_cases, issues, spark_ideas, business_integrations, ai_models).
-- core.tools / core.skills are deliberately excluded (blocked on the open
-- global-vs-tenant catalog scoping decision, README Low #4). The remaining
-- ~40 agent_* detail/junction/risk_management/raw tables (also carrying
-- tenant_id per README Critical #1) are a separate, later rollout — flagging
-- explicitly so this isn't mistaken for full schema-wide coverage.
--
-- This exact ALTER logic is also embedded in each table's own definition
-- file under sql/core/ (agents.sql, business_applications.sql, etc.) so
-- that fresh/dev environments provisioned via
-- tavro_api/api/migrations/init_tables.py pick it up automatically. This
-- file exists solely so you have ONE script to run once, right now, against
-- the already-provisioned hosted production database.
-- =============================================================

DO $$
BEGIN

    -- ============================================================
    -- core.agents — composite PK (tenant_id, company_id, agent_internal_id)
    -- No live FK targets core.agents today, so this is safe to add directly.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_agents_tenant_id_present'
        ) THEN
            ALTER TABLE core.agents
                ADD CONSTRAINT chk_agents_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.agents: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_agents') THEN
            ALTER TABLE core.agents DROP CONSTRAINT IF EXISTS agents_pkey;
            ALTER TABLE core.agents
                ADD CONSTRAINT pk_core_agents PRIMARY KEY (tenant_id, company_id, agent_internal_id);
            RAISE NOTICE 'core.agents: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: composite PK skipped (likely NULL tenant_id/company_id/agent_internal_id still present) — %', SQLERRM;
    END;


    -- ============================================================
    -- core.business_applications — composite PK, reusing the existing
    -- ux_core_business_applications index (same 3 columns) in place.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_applications_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_applications
                ADD CONSTRAINT chk_business_applications_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.business_applications: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_applications: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_business_applications') THEN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_core_business_applications') THEN
                ALTER TABLE core.business_applications
                    ADD CONSTRAINT pk_core_business_applications PRIMARY KEY USING INDEX ux_core_business_applications;
            ELSE
                ALTER TABLE core.business_applications
                    ADD CONSTRAINT pk_core_business_applications PRIMARY KEY (tenant_id, company_id, business_application_id);
            END IF;
            RAISE NOTICE 'core.business_applications: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_applications: composite PK skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.business_processes — composite PK, reusing the existing
    -- ux_core_business_processes index (same 3 columns) in place.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_processes_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_processes
                ADD CONSTRAINT chk_business_processes_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.business_processes: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_processes: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_business_processes') THEN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_core_business_processes') THEN
                ALTER TABLE core.business_processes
                    ADD CONSTRAINT pk_core_business_processes PRIMARY KEY USING INDEX ux_core_business_processes;
            ELSE
                ALTER TABLE core.business_processes
                    ADD CONSTRAINT pk_core_business_processes PRIMARY KEY (tenant_id, company_id, business_process_id);
            END IF;
            RAISE NOTICE 'core.business_processes: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_processes: composite PK skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.ai_use_cases — composite PK (tenant_id, company_id, ai_use_case_id).
    -- The existing ux_core_ai_use_cases UNIQUE (tenant_id, ai_use_case_id) is
    -- a separate, stricter business rule and is left untouched.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_ai_use_cases_tenant_id_present'
        ) THEN
            ALTER TABLE core.ai_use_cases
                ADD CONSTRAINT chk_ai_use_cases_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.ai_use_cases: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_use_cases: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_ai_use_cases') THEN
            ALTER TABLE core.ai_use_cases
                ADD CONSTRAINT pk_core_ai_use_cases PRIMARY KEY (tenant_id, company_id, ai_use_case_id);
            RAISE NOTICE 'core.ai_use_cases: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_use_cases: composite PK skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.issues — composite PK (tenant_id, company_id, issue_id).
    -- The existing ux_core_issues UNIQUE (tenant_id, issue_id) is a
    -- separate, stricter business rule and is left untouched.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_issues_tenant_id_present'
        ) THEN
            ALTER TABLE core.issues
                ADD CONSTRAINT chk_issues_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.issues: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.issues: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_issues') THEN
            ALTER TABLE core.issues
                ADD CONSTRAINT pk_core_issues PRIMARY KEY (tenant_id, company_id, issue_id);
            RAISE NOTICE 'core.issues: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.issues: composite PK skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.spark_ideas — composite PK (tenant_id, company_id, idea_id),
    -- replacing the single-column idea_id PK. No FK targets it today.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_spark_ideas_tenant_id_present'
        ) THEN
            ALTER TABLE core.spark_ideas
                ADD CONSTRAINT chk_spark_ideas_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.spark_ideas: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.spark_ideas: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_spark_ideas') THEN
            ALTER TABLE core.spark_ideas DROP CONSTRAINT IF EXISTS spark_ideas_pkey;
            ALTER TABLE core.spark_ideas
                ADD CONSTRAINT pk_core_spark_ideas PRIMARY KEY (tenant_id, company_id, idea_id);
            RAISE NOTICE 'core.spark_ideas: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.spark_ideas: composite PK skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.business_integrations — NOT converted to composite PK.
    -- integration_id already has a live FK pointing at it
    -- (fk_core_agent_business_integrations_integration on
    -- core.agent_business_integrations). Adds a composite UNIQUE alongside
    -- the existing PK instead — same isolation guarantee, no breaking cascade.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_business_integrations_tenant_id_present'
        ) THEN
            ALTER TABLE core.business_integrations
                ADD CONSTRAINT chk_business_integrations_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.business_integrations: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_integrations: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_core_business_integrations_tenant_company') THEN
            ALTER TABLE core.business_integrations
                ADD CONSTRAINT ux_core_business_integrations_tenant_company UNIQUE (tenant_id, company_id, integration_id);
            RAISE NOTICE 'core.business_integrations: composite UNIQUE added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_integrations: composite UNIQUE skipped — %', SQLERRM;
    END;


    -- ============================================================
    -- core.ai_models — NOT converted to composite PK. ai_model_id already
    -- has four live FKs pointing at it. Adds a composite UNIQUE alongside
    -- the existing key instead — same isolation guarantee, no breaking cascade.
    -- ============================================================
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_ai_models_tenant_id_present'
        ) THEN
            ALTER TABLE core.ai_models
                ADD CONSTRAINT chk_ai_models_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
            RAISE NOTICE 'core.ai_models: tenant_id CHECK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_models: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_core_ai_models_tenant_company') THEN
            ALTER TABLE core.ai_models
                ADD CONSTRAINT ux_core_ai_models_tenant_company UNIQUE (tenant_id, company_id, ai_model_id);
            RAISE NOTICE 'core.ai_models: composite UNIQUE added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_models: composite UNIQUE skipped — %', SQLERRM;
    END;

END $$;

-- After running, check server logs / client output for any "skipped" NOTICE
-- lines above — each one names the table and the reason (almost always
-- pre-existing NULL data), so you know exactly what to clean up before
-- re-running this script to pick up the remaining tables.
