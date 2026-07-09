CREATE TABLE IF NOT EXISTS core.agent_issues (
	tenant_id TEXT,
	company_id TEXT,
	issue_id TEXT,
	title TEXT,
	agent_id TEXT,
	agent_name TEXT,
	agent_internal_id TEXT,
	created_ts TIMESTAMP,
	updated_ts TIMESTAMP
);

-- High #2 (audit_db/README.md): composite FK to core.agents (CASCADE) and
-- composite FK to core.issues (RESTRICT), using the composite PK added in
-- Critical #2. NOT VALID: safe on a live table with existing data;
-- validate later with
-- ALTER TABLE core.agent_issues VALIDATE CONSTRAINT fk_agent_issues_agent;
-- ALTER TABLE core.agent_issues VALIDATE CONSTRAINT fk_agent_issues_issue;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_issues_agent') THEN
        ALTER TABLE core.agent_issues
            ADD CONSTRAINT fk_agent_issues_agent
            FOREIGN KEY (tenant_id, company_id, agent_internal_id)
            REFERENCES core.agents (tenant_id, company_id, agent_internal_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_issues->agents FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_issues_issue') THEN
        ALTER TABLE core.agent_issues
            ADD CONSTRAINT fk_agent_issues_issue
            FOREIGN KEY (tenant_id, company_id, issue_id)
            REFERENCES core.issues (tenant_id, company_id, issue_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'agent_issues->issues FK skipped — %', SQLERRM;
END $$;
