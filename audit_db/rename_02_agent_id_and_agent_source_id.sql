-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- Implements README Critical #5: renames the per-version identity column
-- to be the real agent_id, and demotes the old business-key column to
-- agent_source_id (optional — populated only for agents ingested via a
-- connector; agents created natively in the platform leave it NULL).
--
--   agent_internal_id  ->  agent_id           (the real PK/FK identity)
--   agent_id            ->  agent_source_id   (optional connector attribute)
--
-- RUN THIS AFTER fix_01 / critical_01 / high_02 have already been applied
-- to this database. It only renames columns — it does not need to run
-- before those scripts, and running it first would break them, since they
-- are written against the CURRENT (pre-rename) column names.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - ALTER TABLE ... RENAME COLUMN is metadata-only — no table rewrite, no
--     row scan, near-instant regardless of table size. It takes a brief
--     ACCESS EXCLUSIVE lock on the table for the duration of the rename
--     itself (milliseconds), not for a scan.
--   - Every PRIMARY KEY, FOREIGN KEY, CHECK, and index that references a
--     renamed column is carried forward automatically by Postgres — they
--     are tracked internally by column position, not by name. Nothing
--     needs to be dropped or recreated.
--   - Dynamic and idempotent: walks information_schema for every table
--     that currently has an agent_id and/or agent_internal_id column, in
--     the core/curated/raw/risk_management schemas — no hardcoded table
--     list, so it automatically covers any table added later. Each
--     table's rename is independently guarded; if a table was already
--     renamed (or never had the old column), it's skipped cleanly.
--   - Order within each table matters and is handled here automatically:
--     agent_id -> agent_source_id runs BEFORE agent_internal_id -> agent_id,
--     so the two renames never collide on the same table.
--
-- COORDINATE WITH APPLICATION CODE — every query in the codebase that
-- reads or writes agent_id / agent_internal_id (worker.py,
-- services/upload_processor.py, tavro_api routers, catalog_connector, and
-- the frontend) must deploy in the SAME release as this script. Until
-- that code deploys, it will keep reading/writing the old column names
-- and fail with "column does not exist" the moment this script runs.
-- This is a bigger, separate piece of work — track it before running this
-- script, not as an afterthought.
--
-- AFTER RUNNING — check the NOTICE output for any "skipped" lines; a skip
-- here almost always just means that table has no agent_id/agent_internal_id
-- column (not every table does) or was already renamed.
-- =============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Pass 1: agent_id -> agent_source_id (old business key).
    -- Must run before Pass 2 on the same table, so agent_id is vacated
    -- before agent_internal_id claims that name.
    --
    -- Guarded to tables that STILL have agent_internal_id too: every real
    -- dual-key table in the pre-rename schema carries both columns, so this
    -- also protects against misfiring if run twice, or run against a
    -- fresh/dev database already created from the renamed CREATE TABLE
    -- files (there, a lone agent_id — e.g. on ai_models, which never had a
    -- separate business key — is already the correct new identity and
    -- must not be touched).
    FOR r IN
        SELECT c.table_schema, c.table_name
        FROM information_schema.columns c
        WHERE c.table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND c.column_name = 'agent_id'
          AND EXISTS (
              SELECT 1 FROM information_schema.columns c2
              WHERE c2.table_schema = c.table_schema
                AND c2.table_name = c.table_name
                AND c2.column_name = 'agent_internal_id'
          )
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = r.table_schema
                  AND table_name = r.table_name
                  AND column_name = 'agent_source_id'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE %I.%I RENAME COLUMN agent_id TO agent_source_id',
                    r.table_schema, r.table_name
                );
                RAISE NOTICE '%.%: agent_id -> agent_source_id', r.table_schema, r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '%.%: agent_id -> agent_source_id skipped — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;

    -- Pass 2: agent_internal_id -> agent_id (the real per-version identity,
    -- already the PK/FK target from critical_01/high_02).
    FOR r IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema IN ('core', 'curated', 'raw', 'risk_management')
          AND column_name = 'agent_internal_id'
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = r.table_schema
                  AND table_name = r.table_name
                  AND column_name = 'agent_id'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE %I.%I RENAME COLUMN agent_internal_id TO agent_id',
                    r.table_schema, r.table_name
                );
                RAISE NOTICE '%.%: agent_internal_id -> agent_id', r.table_schema, r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '%.%: agent_internal_id -> agent_id skipped — %', r.table_schema, r.table_name, SQLERRM;
        END;
    END LOOP;

    -- core.agents.parent_agent_internal_id -> parent_agent_id (self-reference
    -- column, swept along for naming consistency with the rename above).
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agents'
              AND column_name = 'parent_agent_internal_id'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agents'
              AND column_name = 'parent_agent_id'
        ) THEN
            ALTER TABLE core.agents RENAME COLUMN parent_agent_internal_id TO parent_agent_id;
            RAISE NOTICE 'core.agents: parent_agent_internal_id -> parent_agent_id';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: parent_agent_internal_id -> parent_agent_id skipped — %', SQLERRM;
    END;

    -- public.agent_attachment.agent_id -> agent_source_id (unscoped table,
    -- not covered by the information_schema loop above since it's in the
    -- public schema, not core/curated/raw/risk_management).
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'agent_attachment'
              AND column_name = 'agent_id'
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'agent_attachment'
              AND column_name = 'agent_source_id'
        ) THEN
            ALTER TABLE public.agent_attachment RENAME COLUMN agent_id TO agent_source_id;
            RAISE NOTICE 'public.agent_attachment: agent_id -> agent_source_id';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'public.agent_attachment: agent_id -> agent_source_id skipped — %', SQLERRM;
    END;
END $$;
