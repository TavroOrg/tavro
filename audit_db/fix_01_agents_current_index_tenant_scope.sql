-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- Fixes: ux_core_agents_current was defined without tenant_id/company_id,
-- making "current" agent identity globally unique instead of per-tenant.
-- This blocked copying an agent between tenants (INSERT hits
-- "duplicate key value violates unique constraint ux_core_agents_current"
-- even though the destination is a different tenant/company).
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - Detects the legacy global-shaped index by definition text (not just
--     name), so it's a no-op if already fixed.
--   - DROP + CREATE UNIQUE INDEX is metadata + index rebuild only; no data
--     is touched. For a large core.agents table, this briefly locks
--     writers during the rebuild — run in a low-traffic window.
--   - This is the SAME fix as sql/core/zz_agent_upsert_unique_indexes.sql
--     (kept in sync there for fresh/dev environments via init_tables.py).
--     This copy is for running once, now, against the already-provisioned
--     production database.
--
-- COORDINATE WITH APPLICATION CODE — the ON CONFLICT clauses in worker.py
-- and services/upload_processor.py target this index by column list, not
-- by name. Deploy the corresponding code fix (already applied in this
-- session) in the same release as this index change, or upserts will fail
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" for the period the two are out of sync.
-- =============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'core' AND indexname = 'ux_core_agents_current'
          AND indexdef NOT LIKE '%tenant_id%'
    ) THEN
        DROP INDEX core.ux_core_agents_current;
        RAISE NOTICE 'Dropped legacy global-scope ux_core_agents_current index';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ux_core_agents_current legacy-index check skipped — %', SQLERRM;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agents_current
ON core.agents (tenant_id, company_id, agent_id)
WHERE is_current = true;
