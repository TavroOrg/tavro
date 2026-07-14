-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- RUN AFTER 01_rename_agent_id_and_agent_source_id.sql — this backfills
-- via core.agents.agent_source_id, which must already mean the demoted,
-- optional business-key column when this runs.
--
-- Finishes what 06_attachment_move_to_core.sql deliberately deferred:
-- moves public.agent_attachment into core, adds tenant_id/company_id,
-- widens its PK to (tenant_id, company_id, id) — matching every other
-- attachment table — but does NOT add a FK to core.agents. Unlike the
-- other 5 attachment tables, agent_attachment links via agent_source_id,
-- which is the stable business key: not unique under SCD2 versioning
-- (multiple agent version-rows can share one), and NULL entirely for
-- platform-created agents. Neither property is FK-safe.
--
-- Also drops two duplicate leftover indexes found on this table
-- (agent_attachment_agent_id_idx, agent_attachment_agent_idx — both on
-- the same (agent_source_id, created_at) columns, artifacts of earlier
-- renames) in favor of the single correctly-named
-- agent_attachment_agent_source_id_idx.
--
-- WHY THE BACKFILL IS CONDITIONAL, NOT A BLIND JOIN: same reasoning as
-- audit_db/06_attachment_move_to_core.sql — agent_source_id is not
-- guaranteed unique across tenants. Checked before writing this script:
-- zero collisions found in this database, but the guard is kept for
-- production databases that may differ. Rows with 0 or 2+ matches are
-- left NULL and surfaced in the diagnostic report at the end.
--
-- SAFE TO RUN ON A LIVE DATABASE — same guarantees as
-- audit_db/06_attachment_move_to_core.sql: SET SCHEMA and ADD COLUMN are
-- metadata-only, backfill only touches currently-NULL rows, NOT NULL
-- promotion and PK widening are gated on zero remaining NULLs, everything
-- is idempotent and guarded.
-- =============================================================

-- ------------------------------------------------------------
-- Step 1: move schema (no-op if already moved)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='agent_attachment') THEN
        ALTER TABLE public.agent_attachment SET SCHEMA core;
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 2: drop duplicate leftover indexes, keep one correctly-named
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='core' AND indexname='agent_attachment_agent_id_idx') THEN
        DROP INDEX core.agent_attachment_agent_id_idx;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='core' AND indexname='agent_attachment_agent_idx') THEN
        DROP INDEX core.agent_attachment_agent_idx;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='core' AND indexname='agent_attachment_agent_source_id_idx') THEN
        CREATE INDEX agent_attachment_agent_source_id_idx
        ON core.agent_attachment (agent_source_id, created_at DESC);
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 3: add tenant_id/company_id (nullable)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='agent_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE core.agent_attachment ADD COLUMN tenant_id TEXT;
        ALTER TABLE core.agent_attachment ADD COLUMN company_id TEXT;
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 4: backfill only unambiguous matches (exactly one candidate)
-- ------------------------------------------------------------
UPDATE core.agent_attachment a
SET tenant_id = cand.tenant_id, company_id = cand.company_id
FROM (
    SELECT DISTINCT agent_source_id, tenant_id, company_id
    FROM core.agents
    WHERE agent_source_id IS NOT NULL
) cand
WHERE a.agent_source_id = cand.agent_source_id
  AND a.tenant_id IS NULL
  AND (SELECT count(*) FROM (SELECT DISTINCT tenant_id, company_id FROM core.agents WHERE agent_source_id = a.agent_source_id) x) = 1;

-- ------------------------------------------------------------
-- Step 5: CHECKs, NOT NULL promotion, PK widening — all gated on zero
-- remaining NULLs, same pattern as 06_attachment_move_to_core.sql
-- ------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_attachment_tenant_id_present') THEN
            ALTER TABLE core.agent_attachment ADD CONSTRAINT chk_agent_attachment_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_agent_attachment_company_id_present') THEN
            ALTER TABLE core.agent_attachment ADD CONSTRAINT chk_agent_attachment_company_id_present
                CHECK (company_id IS NOT NULL AND btrim(company_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agent_attachment: CHECK constraints skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_attachment' AND column_name = 'tenant_id' AND is_nullable = 'NO'
        ) THEN
            ALTER TABLE core.agent_attachment VALIDATE CONSTRAINT chk_agent_attachment_tenant_id_present;
            ALTER TABLE core.agent_attachment VALIDATE CONSTRAINT chk_agent_attachment_company_id_present;
            ALTER TABLE core.agent_attachment ALTER COLUMN tenant_id SET NOT NULL;
            ALTER TABLE core.agent_attachment ALTER COLUMN company_id SET NOT NULL;
            RAISE NOTICE 'core.agent_attachment: tenant_id/company_id set NOT NULL (all rows resolved)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agent_attachment: NOT NULL promotion skipped — unresolved rows remain (see diagnostic report) — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_agent_attachment')
           AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'agent_attachment'
                  AND column_name = 'tenant_id' AND is_nullable = 'NO'
           )
        THEN
            ALTER TABLE core.agent_attachment DROP CONSTRAINT IF EXISTS agent_attachment_pkey;
            ALTER TABLE core.agent_attachment ADD CONSTRAINT pk_agent_attachment PRIMARY KEY (tenant_id, company_id, id);
            RAISE NOTICE 'core.agent_attachment: PK widened to (tenant_id, company_id, id)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agent_attachment: PK widen skipped (likely tenant_id/company_id not yet NOT NULL) — %', SQLERRM;
    END;
END $$;

-- ------------------------------------------------------------
-- Diagnostic report: every row still NULL, with every candidate
-- tenant/company it could belong to.
-- ------------------------------------------------------------
SELECT a.id, a.agent_source_id,
       array_agg(DISTINCT (g.tenant_id || ' / ' || g.company_id)) AS candidate_tenant_company
FROM core.agent_attachment a
LEFT JOIN core.agents g ON g.agent_source_id = a.agent_source_id
WHERE a.tenant_id IS NULL
GROUP BY a.id, a.agent_source_id;
