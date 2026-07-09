-- =============================================================
-- Critical #1 (audit_db/README.md): tenant_id AND company_id must be
-- present on every table that carries them.
--
-- Unlike the FK work (which is inherently relationship-specific, one block
-- per table pair), "does this table have a tenant_id/company_id column and
-- is it populated" is a generic, column-name-driven rule — so this is a
-- single dynamic script, not one edit per table. It loops over
-- information_schema and applies the same guard to every matching table in
-- core/curated/raw/risk_management, including ones added after this file
-- was written.
--
-- Runs automatically on app startup (tavro_api/api/migrations/init_tables.py
-- discovers and executes every sql/core/*.sql file alphabetically). Named
-- to sort after zz_agent_upsert_unique_indexes.sql.
--
-- Each CHECK is added NOT VALID: blocks new violating INSERT/UPDATE
-- immediately, does NOT scan or fail against existing rows at creation
-- time. Idempotent — checked against pg_constraint before adding.
--
-- Deliberately excluded: public.agent_attachment / ai_model_attachment /
-- application_attachment / integration_attachment / process_attachment /
-- use_case_attachment — none have a tenant_id or company_id column at all
-- yet (Critical #6, a separate schema migration).
--
-- Deliberately partial by design, not a gap: raw.agent_card_json,
-- raw.ingestion_log, raw.run_time_logs have tenant_id but no company_id
-- column — ingestion happens before company resolution, so only the
-- tenant_id CHECK applies to those three.
--
-- Once audit_db/check_null_tenant_across_db.sql and
-- check_null_company_id_across_db.sql report zero violations for a table,
-- promote the corresponding CHECK to fully validated (safe on a live
-- table, lightweight lock, not exclusive):
--   ALTER TABLE <schema>.<table> VALIDATE CONSTRAINT chk_<table>_tenant_id_present;
--   ALTER TABLE <schema>.<table> VALIDATE CONSTRAINT chk_<table>_company_id_present;
-- =============================================================

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
END $$;
