-- =============================================================
-- Implements Critical #1 and #2 from audit_db/README.md:
--   1. Enforce tenant_id AND company_id presence on every table that
--      carries them (Zitadel-issued, fetched by the app — not a value
--      Postgres generates, so this only guards presence/format), then
--      promotes that guard to a real NOT NULL constraint once the data is
--      confirmed clean
--   2. Promote composite (tenant_id, company_id, <asset_id>) keys to
--      PRIMARY KEY wherever that is safe without breaking a live FK
--
-- Runs automatically on app startup (tavro_api/api/migrations/init_tables.py
-- discovers and executes every sql/core/*.sql file alphabetically). Named
-- to sort after zz_agent_upsert_unique_indexes.sql, since Section B reuses
-- unique indexes defined there.
--
-- Every table's own CREATE TABLE file under sql/core/ (agents.sql,
-- business_applications.sql, etc.) now contains ONLY its schema
-- definition — every constraint/migration statement for that table lives
-- here instead, consolidated in one place. This is also the exact file to
-- run manually against an already-provisioned hosted database — see
-- audit_db/03_critical_tenant_and_composite_pk.sql, which is kept in sync
-- with this one for that purpose.
--
-- SAFE TO RUN ON A LIVE DATABASE — see audit_db/03_critical_tenant_and_composite_pk.sql
-- for the full safety notes (NOT VALID checks, VALIDATE-then-SET-NOT-NULL
-- promotion, idempotency, and the production notes on large tables).
--
-- SCOPE — Section A (tenant_id/company_id presence + NOT NULL) covers every
-- table across core/curated/raw/risk_management dynamically, via
-- information_schema — no hardcoded table list, so it automatically
-- includes any table added later. Section B (composite PK/UNIQUE) is
-- necessarily hardcoded, since promoting a key is relationship-specific:
-- it covers the 8 "direct owner" tables named in README Critical #2
-- (agents, business_applications, business_processes, ai_use_cases,
-- issues, spark_ideas, business_integrations, ai_models). core.tools /
-- core.skills are deliberately excluded from Section B (blocked on the
-- open global-vs-tenant catalog scoping decision, README Low #4).
--
-- NOT INCLUDED — see audit_db/README.md Critical #6: public.agent_attachment,
-- ai_model_attachment, application_attachment, integration_attachment,
-- process_attachment, use_case_attachment have no tenant_id or company_id
-- column at all. Adding one is part of the attachment-table schema
-- migration, not this pass.
--
-- DELIBERATELY PARTIAL, NOT A GAP — raw.agent_card_json, raw.ingestion_log,
-- raw.run_time_logs have tenant_id but no company_id column: ingestion
-- happens before company resolution, so only the tenant_id CHECK applies
-- to those three.
-- =============================================================

-- ============================================================
-- SECTION A — tenant_id AND company_id presence, every table
-- ============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- tenant_id presence
    FOR r IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND column_name = 'tenant_id'
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = r.table_schema
                  AND c.conname = 'chk_' || r.table_name || '_tenant_id_present'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '''') NOT VALID',
                    r.table_schema, r.table_name, 'chk_' || r.table_name || '_tenant_id_present'
                );
                RAISE NOTICE 'Added NOT VALID tenant_id CHECK on %.%', r.table_schema, r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Skipped tenant_id CHECK on %.% — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;

    -- company_id presence
    FOR r IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND column_name = 'company_id'
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = r.table_schema
                  AND c.conname = 'chk_' || r.table_name || '_company_id_present'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (company_id IS NOT NULL AND btrim(company_id) <> '''') NOT VALID',
                    r.table_schema, r.table_name, 'chk_' || r.table_name || '_company_id_present'
                );
                RAISE NOTICE 'Added NOT VALID company_id CHECK on %.%', r.table_schema, r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Skipped company_id CHECK on %.% — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;

    -- ============================================================
    -- Promote tenant_id / company_id from CHECK (NOT VALID) to real
    -- NOT NULL. VALIDATE first — proves no existing NULL/blank rows, and
    -- lets Postgres treat the subsequent SET NOT NULL as metadata-only
    -- rather than a full table scan. If a table isn't clean yet, VALIDATE
    -- fails, the guard catches it, and that table is simply skipped — safe
    -- to re-run this script later once its data is fixed.
    -- ============================================================

    -- tenant_id NOT NULL
    FOR r IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND column_name = 'tenant_id'
          AND is_nullable = 'YES'
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
                r.table_schema, r.table_name, 'chk_' || r.table_name || '_tenant_id_present'
            );
            EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', r.table_schema, r.table_name);
            RAISE NOTICE 'tenant_id set NOT NULL on %.%', r.table_schema, r.table_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'tenant_id NOT NULL promotion skipped on %.% (likely existing NULL/blank rows) — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;

    -- company_id NOT NULL
    FOR r IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND column_name = 'company_id'
          AND is_nullable = 'YES'
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
                r.table_schema, r.table_name, 'chk_' || r.table_name || '_company_id_present'
            );
            EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN company_id SET NOT NULL', r.table_schema, r.table_name);
            RAISE NOTICE 'company_id set NOT NULL on %.%', r.table_schema, r.table_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'company_id NOT NULL promotion skipped on %.% (likely existing NULL/blank rows) — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;
END $$;


-- ============================================================
-- SECTION B — composite primary keys / unique constraints,
-- the 8 direct-owner tables
-- ============================================================

DO $$
BEGIN

    -- core.agents — composite PK (tenant_id, company_id, agent_id)
    -- No live FK targets core.agents today, so this is safe to add directly.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_agents') THEN
            ALTER TABLE core.agents DROP CONSTRAINT IF EXISTS agents_pkey;
            ALTER TABLE core.agents
                ADD CONSTRAINT pk_core_agents PRIMARY KEY (tenant_id, company_id, agent_id);
            RAISE NOTICE 'core.agents: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: composite PK skipped (likely NULL tenant_id/company_id/agent_id still present) — %', SQLERRM;
    END;

    -- core.business_applications — composite PK, reusing the existing
    -- ux_core_business_applications index (same 3 columns) in place.
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

    -- core.business_processes — composite PK, reusing the existing
    -- ux_core_business_processes index (same 3 columns) in place.
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

    -- core.ai_use_cases — composite PK (tenant_id, company_id, ai_use_case_id).
    -- The existing ux_core_ai_use_cases UNIQUE (tenant_id, ai_use_case_id) is
    -- a separate, stricter business rule and is left untouched.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_ai_use_cases') THEN
            ALTER TABLE core.ai_use_cases
                ADD CONSTRAINT pk_core_ai_use_cases PRIMARY KEY (tenant_id, company_id, ai_use_case_id);
            RAISE NOTICE 'core.ai_use_cases: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.ai_use_cases: composite PK skipped — %', SQLERRM;
    END;

    -- core.issues — composite PK (tenant_id, company_id, issue_id).
    -- The existing ux_core_issues UNIQUE (tenant_id, issue_id) is a
    -- separate, stricter business rule and is left untouched.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_issues') THEN
            ALTER TABLE core.issues
                ADD CONSTRAINT pk_core_issues PRIMARY KEY (tenant_id, company_id, issue_id);
            RAISE NOTICE 'core.issues: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.issues: composite PK skipped — %', SQLERRM;
    END;

    -- core.spark_ideas — composite PK (tenant_id, company_id, idea_id),
    -- replacing the single-column idea_id PK. No FK targets it today.
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

    -- core.business_integrations — NOT converted to composite PK.
    -- integration_id already has a live FK pointing at it
    -- (fk_core_agent_business_integrations_integration on
    -- core.agent_business_integrations). Adds a composite UNIQUE alongside
    -- the existing PK instead — same isolation guarantee, no breaking cascade.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_core_business_integrations_tenant_company') THEN
            ALTER TABLE core.business_integrations
                ADD CONSTRAINT ux_core_business_integrations_tenant_company UNIQUE (tenant_id, company_id, integration_id);
            RAISE NOTICE 'core.business_integrations: composite UNIQUE added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.business_integrations: composite UNIQUE skipped — %', SQLERRM;
    END;

    -- core.ai_models — NOT converted to composite PK. ai_model_id already
    -- has four live FKs pointing at it. Adds a composite UNIQUE alongside
    -- the existing key instead — same isolation guarantee, no breaking cascade.
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
