-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- Moves 5 of the 6 public.*_attachment tables into core, and adds
-- tenant_id/company_id + a composite FK to their parent entity —
-- README Critical #6, minus agent_attachment (deferred separately: its
-- link column follows core.agents' SCD2-versioned identity, which needs
-- fix_01/critical_01/high_02/rename_02 re-applied first — see chat).
--
-- SCOPE: ai_model_attachment, application_attachment,
-- integration_attachment, process_attachment, use_case_attachment.
--
-- WHY THE BACKFILL IS CONDITIONAL, NOT A BLIND JOIN:
-- These tables' link columns (ai_model_id, application_id, etc.) are NOT
-- guaranteed unique across tenants — e.g. 660 distinct business_application_id
-- values in this database's core.business_applications are shared by
-- exactly 2 different tenants. Backfilling tenant_id by joining on the
-- business key alone would silently assign some attachments to the WRONG
-- tenant wherever that key collides. Each backfill below only fills a row
-- when its business key matches EXACTLY ONE (tenant_id, company_id) pair;
-- rows with 0 or 2+ matches are left NULL and surfaced in the diagnostic
-- report at the end of this file for manual resolution.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - ALTER TABLE ... SET SCHEMA is metadata-only (no data movement, no
--     table rewrite) — near-instant regardless of table size.
--   - ADD COLUMN (nullable) is metadata-only.
--   - Backfill UPDATEs only touch rows with an unambiguous match and a
--     currently-NULL tenant_id — safe to re-run.
--   - The composite FK is added NOT VALID (blocks new bad data
--     immediately, doesn't scan existing rows) and only enforces rows
--     that already have a non-NULL tenant_id/company_id — ambiguous rows
--     left NULL are simply not checked by the FK until resolved.
--   - tenant_id/company_id are NOT promoted to NOT NULL here — that only
--     happens automatically once every row is resolved (see the guarded
--     block per table); until then they stay nullable on purpose.
--   - Idempotent: every step is guarded (schema/column/constraint
--     existence checks).
--
-- AFTER RUNNING: read the diagnostic report at the bottom. For each
-- ambiguous row it lists every candidate (tenant_id, company_id), so
-- whoever has the product context to pick the right one can run:
--   UPDATE core.<table> SET tenant_id = '<chosen>', company_id = '<chosen>'
--   WHERE id = '<row id>';
-- Once every row in a table is resolved, re-run this script — the NOT
-- NULL promotion block for that table will then succeed.
-- =============================================================

-- ------------------------------------------------------------
-- Step 1: move schema (no-op if already moved)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='ai_model_attachment') THEN
        ALTER TABLE public.ai_model_attachment SET SCHEMA core;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='application_attachment') THEN
        ALTER TABLE public.application_attachment SET SCHEMA core;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='integration_attachment') THEN
        ALTER TABLE public.integration_attachment SET SCHEMA core;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='process_attachment') THEN
        ALTER TABLE public.process_attachment SET SCHEMA core;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='use_case_attachment') THEN
        ALTER TABLE public.use_case_attachment SET SCHEMA core;
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 2: add tenant_id/company_id (nullable) to each
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='ai_model_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.ai_model_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.ai_model_attachment ADD COLUMN company_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='application_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.application_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.application_attachment ADD COLUMN company_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='integration_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.integration_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.integration_attachment ADD COLUMN company_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='process_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.process_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.process_attachment ADD COLUMN company_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='use_case_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.use_case_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.use_case_attachment ADD COLUMN company_id TEXT;
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 3: backfill only unambiguous matches (exactly one candidate)
-- ------------------------------------------------------------

UPDATE core.ai_model_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT ai_model_id, tenant_id, company_id
    FROM core.ai_models
) cand
WHERE a.ai_model_id = cand.ai_model_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.ai_models WHERE ai_model_id = a.ai_model_id) x) = 1;

UPDATE core.application_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT business_application_id, tenant_id, company_id
    FROM core.business_applications
) cand
WHERE a.application_id = cand.business_application_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.business_applications WHERE business_application_id = a.application_id) x) = 1;

UPDATE core.integration_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT integration_id, tenant_id, company_id
    FROM core.business_integrations
) cand
WHERE a.integration_id = cand.integration_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.business_integrations WHERE integration_id = a.integration_id) x) = 1;

UPDATE core.process_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT business_process_id, tenant_id, company_id
    FROM core.business_processes
) cand
WHERE a.process_id = cand.business_process_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.business_processes WHERE business_process_id = a.process_id) x) = 1;

UPDATE core.use_case_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT ai_use_case_id, tenant_id, company_id
    FROM core.ai_use_cases
) cand
WHERE a.use_case_id = cand.ai_use_case_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.ai_use_cases WHERE ai_use_case_id = a.use_case_id) x) = 1;

-- ------------------------------------------------------------
-- Step 4: composite FK (NOT VALID — only checks non-NULL rows) + CHECKs
-- (CHECKs are added NOT VALID too, so they don't block on ambiguous NULLs;
-- NOT NULL promotion, gated on zero remaining NULLs, is what actually
-- enforces presence once every row is resolved.)
-- ------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('ai_model_attachment', 'ai_model_id', 'ai_models', 'ai_model_id', 'fk_ai_model_attachment_ai_model'),
            ('application_attachment', 'application_id', 'business_applications', 'business_application_id', 'fk_application_attachment_application'),
            ('integration_attachment', 'integration_id', 'business_integrations', 'integration_id', 'fk_integration_attachment_integration'),
            ('process_attachment', 'process_id', 'business_processes', 'business_process_id', 'fk_process_attachment_process'),
            ('use_case_attachment', 'use_case_id', 'ai_use_cases', 'ai_use_case_id', 'fk_use_case_attachment_use_case')
        ) AS t(child_table, child_col, parent_table, parent_col, fk_name)
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = 'core' AND c.conname = 'chk_' || r.child_table || '_tenant_id_present'
            ) THEN
                EXECUTE format('ALTER TABLE core.%I ADD CONSTRAINT %I CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '''') NOT VALID',
                    r.child_table, 'chk_' || r.child_table || '_tenant_id_present');
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = 'core' AND c.conname = 'chk_' || r.child_table || '_company_id_present'
            ) THEN
                EXECUTE format('ALTER TABLE core.%I ADD CONSTRAINT %I CHECK (company_id IS NOT NULL AND btrim(company_id) <> '''') NOT VALID',
                    r.child_table, 'chk_' || r.child_table || '_company_id_present');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'core.%: CHECK constraints skipped — %', r.child_table, SQLERRM;
        END;

        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.fk_name) THEN
                EXECUTE format(
                    'ALTER TABLE core.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, company_id, %I) REFERENCES core.%I (tenant_id, company_id, %I) ON DELETE CASCADE NOT VALID',
                    r.child_table, r.fk_name, r.child_col, r.parent_table, r.parent_col
                );
                RAISE NOTICE 'core.%: composite FK to % added', r.child_table, r.parent_table;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'core.%: composite FK skipped — %', r.child_table, SQLERRM;
        END;

        -- NOT NULL promotion — only succeeds once every row is resolved
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = r.child_table AND column_name = 'tenant_id' AND is_nullable = 'NO'
            ) THEN
                EXECUTE format('ALTER TABLE core.%I VALIDATE CONSTRAINT %I', r.child_table, 'chk_' || r.child_table || '_tenant_id_present');
                EXECUTE format('ALTER TABLE core.%I VALIDATE CONSTRAINT %I', r.child_table, 'chk_' || r.child_table || '_company_id_present');
                EXECUTE format('ALTER TABLE core.%I ALTER COLUMN tenant_id SET NOT NULL', r.child_table);
                EXECUTE format('ALTER TABLE core.%I ALTER COLUMN company_id SET NOT NULL', r.child_table);
                RAISE NOTICE 'core.%: tenant_id/company_id set NOT NULL (all rows resolved)', r.child_table;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'core.%: NOT NULL promotion skipped — unresolved rows remain (see diagnostic report) — %', r.child_table, SQLERRM;
        END;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- Diagnostic report: every row still NULL, with every candidate tenant/
-- company it could belong to. Use this to hand-write the resolving
-- UPDATE statements described in the header comment.
-- ------------------------------------------------------------
SELECT 'ai_model_attachment' AS attachment_table, a.id, a.ai_model_id AS business_key,
       array_agg(DISTINCT (m.tenant_id || ' / ' || m.company_id)) AS candidate_tenant_company
FROM core.ai_model_attachment a
LEFT JOIN core.ai_models m ON m.ai_model_id = a.ai_model_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.ai_model_id
UNION ALL
SELECT 'application_attachment', a.id, a.application_id,
       array_agg(DISTINCT (m.tenant_id || ' / ' || m.company_id))
FROM core.application_attachment a
LEFT JOIN core.business_applications m ON m.business_application_id = a.application_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.application_id
UNION ALL
SELECT 'integration_attachment', a.id, a.integration_id,
       array_agg(DISTINCT (m.tenant_id || ' / ' || m.company_id))
FROM core.integration_attachment a
LEFT JOIN core.business_integrations m ON m.integration_id = a.integration_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.integration_id
UNION ALL
SELECT 'process_attachment', a.id, a.process_id,
       array_agg(DISTINCT (m.tenant_id || ' / ' || m.company_id))
FROM core.process_attachment a
LEFT JOIN core.business_processes m ON m.business_process_id = a.process_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.process_id
UNION ALL
SELECT 'use_case_attachment', a.id, a.use_case_id,
       array_agg(DISTINCT (m.tenant_id || ' / ' || m.company_id))
FROM core.use_case_attachment a
LEFT JOIN core.ai_use_cases m ON m.ai_use_case_id = a.use_case_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.use_case_id;
