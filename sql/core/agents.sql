CREATE TABLE IF NOT EXISTS core.agents (
	tenant_id TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_description TEXT,
	protocol_version TEXT,
	preferred_transport TEXT,
	supports_auth_ext_card boolean,
	card_version TEXT,
	source_hash TEXT,
	source_system TEXT,
	record_hash TEXT,
	valid_from_ts timestamp,
	valid_to_ts timestamp,
	is_current boolean,
	created_ts timestamp,
	updated_ts timestamp,
	agent_internal_id TEXT,
	parent_agent_internal_id TEXT,
	company_id TEXT,
	company_name TEXT,
	agent_type TEXT DEFAULT 'Config-driven'
);

-- Critical #1 (audit_db/README.md): reject new rows with a missing/blank
-- tenant_id without requiring historic data to be clean first (NOT VALID).
-- Once audit_db/check_null_tenant_across_db.sql shows zero violations, run:
--   ALTER TABLE core.agents VALIDATE CONSTRAINT chk_agents_tenant_id_present;
--
-- Critical #2: composite primary key (tenant_id, company_id, agent_internal_id)
-- bakes tenant/company scoping into the identity used by every child/junction
-- table. No foreign key currently targets core.agents, so this is safe to add
-- without a coordinated FK migration.
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'core' AND c.conname = 'chk_agents_tenant_id_present'
        ) THEN
            ALTER TABLE core.agents
                ADD CONSTRAINT chk_agents_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: tenant_id CHECK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_core_agents') THEN
            ALTER TABLE core.agents DROP CONSTRAINT IF EXISTS agents_pkey;
            ALTER TABLE core.agents
                ADD CONSTRAINT pk_core_agents PRIMARY KEY (tenant_id, company_id, agent_internal_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'core.agents: composite PK skipped — %', SQLERRM;
    END;
END $$;

