CREATE TABLE IF NOT EXISTS core.issues (
	tenant_id TEXT,
	company_id TEXT,
	issue_id TEXT,
	title TEXT,
	description TEXT,
	issue_type TEXT,
	severity TEXT,
	source TEXT,
	detected_at TIMESTAMP,
	resolved_at TIMESTAMP,
	status TEXT,
	resolution_notes TEXT,
	assignee TEXT,
	owner TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.issues VALIDATE CONSTRAINT chk_issues_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, issue_id).
-- The existing ux_core_issues UNIQUE (tenant_id, issue_id) is kept as-is —
-- it is a stricter, separate business-uniqueness rule.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_issues_tenant_id_present'
        ) THEN
            ALTER TABLE core.issues
                ADD CONSTRAINT chk_issues_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.issues: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_issues') THEN
            ALTER TABLE core.issues
                ADD CONSTRAINT pk_core_issues PRIMARY KEY (tenant_id, company_id, issue_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.issues: composite PK skipped — %', SQLERRM;
    END;
END $$;
