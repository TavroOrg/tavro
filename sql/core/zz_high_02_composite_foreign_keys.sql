-- =============================================================
-- Implements High #2 from audit_db/README.md: foreign keys across the
-- agent/catalog/junction graph, using COMPOSITE (tenant_id, company_id, id)
-- keys wherever the referenced table's key is composite (per Critical #2),
-- and single-column keys where it is not.
--
-- Runs automatically on app startup (tavro_api/api/migrations/init_tables.py
-- discovers and executes every sql/core/*.sql file alphabetically). Named
-- to sort after zz_critical_01_tenant_and_composite_pk.sql — every FK here
-- targets a PRIMARY KEY or UNIQUE constraint added by that file.
--
-- Every table's own CREATE TABLE file under sql/core/ now contains ONLY
-- its schema definition — every FK for that table lives here instead,
-- consolidated in one place. This is also the exact file to run manually
-- against an already-provisioned hosted database — see
-- audit_db/high_02_composite_foreign_keys.sql, kept in sync with this one.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - Every FK is added NOT VALID: blocks new violating INSERT/UPDATE
--     immediately, does NOT scan or fail against existing rows at creation
--     time. No downtime risk from pre-existing orphaned rows.
--   - Each FK is independently guarded (its own BEGIN/EXCEPTION block) and
--     idempotent (checked against pg_constraint) — one table's issue does
--     not abort the rest of this script.
--   - Five existing single-column FKs (agent_business_integrations,
--     agent_ai_models, and the three ai_model_* junctions) are LEFT IN PLACE
--     UNTOUCHED. A new composite FK is added ALONGSIDE each one instead of
--     replacing it — nothing is ever dropped.
--
-- AFTER RUNNING — validate once you've confirmed no orphans exist (each
-- VALIDATE takes a lightweight lock, safe on a live table):
--   ALTER TABLE <schema>.<table> VALIDATE CONSTRAINT <constraint_name>;
-- (constraint names are shown in the RAISE NOTICE lines when each is added)
--
-- DELIBERATELY NOT INCLUDED — see audit_db/README.md for reasoning:
--   - application_attachment / process_attachment / use_case_attachment →
--     their target tables' key is now composite-only (Critical #2), and
--     these attachment tables don't yet carry tenant_id/company_id
--     (Critical #6). Blocked until Critical #6 lands.
--   - agent_attachment → agents: agent_attachment.agent_source_id is the
--     stable business key and is not unique under SCD2 versioning (same
--     root cause as Critical #5 — agent_id, formerly agent_internal_id, is
--     the identity; agent_source_id should not be FK'd against).
--   - agent_tools/agent_skills/tool_tables → tools/skills: blocked on the
--     open global-vs-tenant catalog scoping decision (README Low #4).
--   - agent_resources: no column links it to an agent at all; needs
--     product/eng input on the intended relationship before a FK can be
--     written with confidence.
-- =============================================================

DO $$
BEGIN

    -- ============================================================
    -- SECTION A — agent_* detail tables → core.agents (composite, CASCADE)
    -- Deleting an agent should clean up everything that only exists
    -- because of that agent.
    -- ============================================================

    -- agent_configurations
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_configurations_agent') THEN
            ALTER TABLE core.agent_configurations
                ADD CONSTRAINT fk_agent_configurations_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_configurations: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_configurations FK skipped — %', SQLERRM; END;

    -- agent_identifications
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_identifications_agent') THEN
            ALTER TABLE core.agent_identifications
                ADD CONSTRAINT fk_agent_identifications_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_identifications: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_identifications FK skipped — %', SQLERRM; END;

    -- agent_controls
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_controls_agent') THEN
            ALTER TABLE core.agent_controls
                ADD CONSTRAINT fk_agent_controls_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_controls: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_controls FK skipped — %', SQLERRM; END;

    -- agent_guardrails
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_guardrails_agent') THEN
            ALTER TABLE core.agent_guardrails
                ADD CONSTRAINT fk_agent_guardrails_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_guardrails: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_guardrails FK skipped — %', SQLERRM; END;

    -- agent_memories
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_memories_agent') THEN
            ALTER TABLE core.agent_memories
                ADD CONSTRAINT fk_agent_memories_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_memories: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_memories FK skipped — %', SQLERRM; END;

    -- agent_knowledge_sources
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_knowledge_sources_agent') THEN
            ALTER TABLE core.agent_knowledge_sources
                ADD CONSTRAINT fk_agent_knowledge_sources_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_knowledge_sources: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_knowledge_sources FK skipped — %', SQLERRM; END;

    -- agent_prompt_templates
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_prompt_templates_agent') THEN
            ALTER TABLE core.agent_prompt_templates
                ADD CONSTRAINT fk_agent_prompt_templates_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_prompt_templates: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_prompt_templates FK skipped — %', SQLERRM; END;

    -- agent_mcp_servers
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_mcp_servers_agent') THEN
            ALTER TABLE core.agent_mcp_servers
                ADD CONSTRAINT fk_agent_mcp_servers_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_mcp_servers: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_mcp_servers FK skipped — %', SQLERRM; END;

    -- agent_llm_models
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_llm_models_agent') THEN
            ALTER TABLE core.agent_llm_models
                ADD CONSTRAINT fk_agent_llm_models_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_llm_models: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_llm_models FK skipped — %', SQLERRM; END;

    -- agent_physical_ai
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_physical_ai_agent') THEN
            ALTER TABLE core.agent_physical_ai
                ADD CONSTRAINT fk_agent_physical_ai_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_physical_ai: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_physical_ai FK skipped — %', SQLERRM; END;

    -- agent_regulations_or_frameworks
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_regulations_or_frameworks_agent') THEN
            ALTER TABLE core.agent_regulations_or_frameworks
                ADD CONSTRAINT fk_agent_regulations_or_frameworks_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_regulations_or_frameworks: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_regulations_or_frameworks FK skipped — %', SQLERRM; END;

    -- agent_generated_code
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_generated_code_agent') THEN
            ALTER TABLE core.agent_generated_code
                ADD CONSTRAINT fk_agent_generated_code_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_generated_code: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_generated_code FK skipped — %', SQLERRM; END;

    -- agent_data_sources
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_data_sources_agent') THEN
            ALTER TABLE core.agent_data_sources
                ADD CONSTRAINT fk_agent_data_sources_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_data_sources: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_data_sources FK skipped — %', SQLERRM; END;

    -- agent_governance_events — SET NULL, not CASCADE: these are audit/
    -- compliance events and should outlive the agent they were logged
    -- against rather than disappear when the agent is deleted.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_governance_events_agent') THEN
            ALTER TABLE core.agent_governance_events
                ADD CONSTRAINT fk_agent_governance_events_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE SET NULL NOT VALID;
            RAISE NOTICE 'agent_governance_events: composite FK to agents added (SET NULL)';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_governance_events FK skipped — %', SQLERRM; END;

    -- agent_risk_assessments — RESTRICT, not CASCADE: risk history should
    -- block accidental agent deletion, not silently vanish with it.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_risk_assessments_agent') THEN
            ALTER TABLE core.agent_risk_assessments
                ADD CONSTRAINT fk_agent_risk_assessments_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_risk_assessments: composite FK to agents added (RESTRICT)';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_risk_assessments FK skipped — %', SQLERRM; END;


    -- ============================================================
    -- SECTION B — agent ↔ catalog junction tables
    -- Agent-side = CASCADE (association is meaningless without the agent).
    -- Catalog-side = RESTRICT (don't silently vanish a shared catalog entity
    -- while agents still reference it).
    -- ============================================================

    -- agent_tools — agent-side only; tools-side deferred (README Low #4)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tools_agent') THEN
            ALTER TABLE core.agent_tools
                ADD CONSTRAINT fk_agent_tools_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_tools: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_tools FK skipped — %', SQLERRM; END;

    -- agent_skills — agent-side only; skills-side deferred (README Low #4)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_skills_agent') THEN
            ALTER TABLE core.agent_skills
                ADD CONSTRAINT fk_agent_skills_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_skills: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_skills FK skipped — %', SQLERRM; END;

    -- agent_tables — agent-side composite; tables-side single-column
    -- (core.tables' key was not touched by Critical #2)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tables_agent') THEN
            ALTER TABLE core.agent_tables
                ADD CONSTRAINT fk_agent_tables_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_tables: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_tables->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_tables_table') THEN
            ALTER TABLE core.agent_tables
                ADD CONSTRAINT fk_agent_tables_table
                FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_tables: FK to tables added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_tables->tables FK skipped — %', SQLERRM; END;

    -- agent_business_applications — agent-side composite CASCADE;
    -- catalog-side composite RESTRICT (business_applications now has a
    -- composite PK from Critical #2)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_applications_agent') THEN
            ALTER TABLE core.agent_business_applications
                ADD CONSTRAINT fk_agent_business_applications_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_business_applications: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_applications->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_applications_application') THEN
            ALTER TABLE core.agent_business_applications
                ADD CONSTRAINT fk_agent_business_applications_application
                FOREIGN KEY (tenant_id, company_id, business_application_id)
                REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_business_applications: composite FK to business_applications added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_applications->business_applications FK skipped — %', SQLERRM; END;

    -- agent_business_processes — same pattern
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_processes_agent') THEN
            ALTER TABLE core.agent_business_processes
                ADD CONSTRAINT fk_agent_business_processes_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_business_processes: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_processes->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_processes_process') THEN
            ALTER TABLE core.agent_business_processes
                ADD CONSTRAINT fk_agent_business_processes_process
                FOREIGN KEY (tenant_id, company_id, business_process_id)
                REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_business_processes: composite FK to business_processes added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_processes->business_processes FK skipped — %', SQLERRM; END;

    -- agent_business_integrations — agent-side composite CASCADE (new);
    -- catalog-side gets a NEW composite FK added ALONGSIDE the existing
    -- single-column FK (fk_core_agent_business_integrations_integration),
    -- which is left untouched, using the
    -- ux_core_business_integrations_tenant_company UNIQUE added alongside
    -- business_integrations' original PK in Critical #2.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_integrations_agent') THEN
            ALTER TABLE core.agent_business_integrations
                ADD CONSTRAINT fk_agent_business_integrations_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_business_integrations: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_integrations->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_business_integrations_integration') THEN
            ALTER TABLE core.agent_business_integrations
                ADD CONSTRAINT fk_agent_business_integrations_integration
                FOREIGN KEY (tenant_id, company_id, integration_id)
                REFERENCES core.business_integrations (tenant_id, company_id, integration_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_business_integrations: composite FK to business_integrations added alongside existing fk_core_agent_business_integrations_integration';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_business_integrations->business_integrations FK skipped — %', SQLERRM; END;

    -- agent_ai_models — agent-side composite CASCADE (new);
    -- catalog-side gets a NEW composite FK added ALONGSIDE the existing
    -- fk_core_agent_ai_models_ai_model, which is left untouched, using
    -- ux_core_ai_models_tenant_company.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_models_agent') THEN
            ALTER TABLE core.agent_ai_models
                ADD CONSTRAINT fk_agent_ai_models_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_ai_models: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_ai_models->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_models_ai_model') THEN
            ALTER TABLE core.agent_ai_models
                ADD CONSTRAINT fk_agent_ai_models_ai_model
                FOREIGN KEY (tenant_id, company_id, ai_model_id)
                REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_ai_models: composite FK to ai_models added alongside existing fk_core_agent_ai_models_ai_model';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_ai_models->ai_models FK skipped — %', SQLERRM; END;

    -- agent_ai_use_cases — agent-side composite CASCADE; catalog-side
    -- composite RESTRICT (ai_use_cases now has a composite PK)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_use_cases_agent') THEN
            ALTER TABLE core.agent_ai_use_cases
                ADD CONSTRAINT fk_agent_ai_use_cases_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_ai_use_cases: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_ai_use_cases->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_ai_use_cases_use_case') THEN
            ALTER TABLE core.agent_ai_use_cases
                ADD CONSTRAINT fk_agent_ai_use_cases_use_case
                FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
                REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_ai_use_cases: composite FK to ai_use_cases added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_ai_use_cases->ai_use_cases FK skipped — %', SQLERRM; END;

    -- agent_issues — agent-side composite CASCADE; issues-side composite
    -- RESTRICT (core.issues now has a composite PK)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_issues_agent') THEN
            ALTER TABLE core.agent_issues
                ADD CONSTRAINT fk_agent_issues_agent
                FOREIGN KEY (tenant_id, company_id, agent_id)
                REFERENCES core.agents (tenant_id, company_id, agent_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_issues: composite FK to agents added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_issues->agents FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_issues_issue') THEN
            ALTER TABLE core.agent_issues
                ADD CONSTRAINT fk_agent_issues_issue
                FOREIGN KEY (tenant_id, company_id, issue_id)
                REFERENCES core.issues (tenant_id, company_id, issue_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'agent_issues: composite FK to issues added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_issues->issues FK skipped — %', SQLERRM; END;


    -- ============================================================
    -- SECTION C — catalog ↔ catalog junction tables (composite, RESTRICT
    -- both sides — no "owning" side, so neither parent should silently
    -- lose linked rows when the other side is deleted)
    -- ============================================================

    -- ai_model_ai_use_cases
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_ai_use_cases_ai_model') THEN
            ALTER TABLE core.ai_model_ai_use_cases
                ADD CONSTRAINT fk_ai_model_ai_use_cases_ai_model
                FOREIGN KEY (tenant_id, company_id, ai_model_id)
                REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_ai_use_cases: composite FK to ai_models added alongside existing fk_core_ai_model_ai_use_cases_ai_model';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_ai_use_cases->ai_models FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_ai_use_cases_use_case') THEN
            ALTER TABLE core.ai_model_ai_use_cases
                ADD CONSTRAINT fk_ai_model_ai_use_cases_use_case
                FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
                REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_ai_use_cases: composite FK to ai_use_cases added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_ai_use_cases->ai_use_cases FK skipped — %', SQLERRM; END;

    -- ai_model_business_applications
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_applications_ai_model') THEN
            ALTER TABLE core.ai_model_business_applications
                ADD CONSTRAINT fk_ai_model_business_applications_ai_model
                FOREIGN KEY (tenant_id, company_id, ai_model_id)
                REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_business_applications: composite FK to ai_models added alongside existing fk_core_ai_model_business_applications_ai_model';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_business_applications->ai_models FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_applications_application') THEN
            ALTER TABLE core.ai_model_business_applications
                ADD CONSTRAINT fk_ai_model_business_applications_application
                FOREIGN KEY (tenant_id, company_id, business_application_id)
                REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_business_applications: composite FK to business_applications added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_business_applications->business_applications FK skipped — %', SQLERRM; END;

    -- ai_model_business_processes
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_processes_ai_model') THEN
            ALTER TABLE core.ai_model_business_processes
                ADD CONSTRAINT fk_ai_model_business_processes_ai_model
                FOREIGN KEY (tenant_id, company_id, ai_model_id)
                REFERENCES core.ai_models (tenant_id, company_id, ai_model_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_business_processes: composite FK to ai_models added alongside existing fk_core_ai_model_business_processes_ai_model';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_business_processes->ai_models FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_model_business_processes_process') THEN
            ALTER TABLE core.ai_model_business_processes
                ADD CONSTRAINT fk_ai_model_business_processes_process
                FOREIGN KEY (tenant_id, company_id, business_process_id)
                REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_model_business_processes: composite FK to business_processes added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_model_business_processes->business_processes FK skipped — %', SQLERRM; END;

    -- ai_use_case_business_applications
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_applications_use_case') THEN
            ALTER TABLE core.ai_use_case_business_applications
                ADD CONSTRAINT fk_ai_use_case_business_applications_use_case
                FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
                REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_use_case_business_applications: composite FK to ai_use_cases added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_use_case_business_applications->ai_use_cases FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_applications_application') THEN
            ALTER TABLE core.ai_use_case_business_applications
                ADD CONSTRAINT fk_ai_use_case_business_applications_application
                FOREIGN KEY (tenant_id, company_id, business_application_id)
                REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_use_case_business_applications: composite FK to business_applications added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_use_case_business_applications->business_applications FK skipped — %', SQLERRM; END;

    -- ai_use_case_business_processes
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_processes_use_case') THEN
            ALTER TABLE core.ai_use_case_business_processes
                ADD CONSTRAINT fk_ai_use_case_business_processes_use_case
                FOREIGN KEY (tenant_id, company_id, ai_use_case_id)
                REFERENCES core.ai_use_cases (tenant_id, company_id, ai_use_case_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_use_case_business_processes: composite FK to ai_use_cases added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_use_case_business_processes->ai_use_cases FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_use_case_business_processes_process') THEN
            ALTER TABLE core.ai_use_case_business_processes
                ADD CONSTRAINT fk_ai_use_case_business_processes_process
                FOREIGN KEY (tenant_id, company_id, business_process_id)
                REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'ai_use_case_business_processes: composite FK to business_processes added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ai_use_case_business_processes->business_processes FK skipped — %', SQLERRM; END;

    -- business_process_business_applications
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_process_business_applications_process') THEN
            ALTER TABLE core.business_process_business_applications
                ADD CONSTRAINT fk_business_process_business_applications_process
                FOREIGN KEY (tenant_id, company_id, business_process_id)
                REFERENCES core.business_processes (tenant_id, company_id, business_process_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'business_process_business_applications: composite FK to business_processes added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'business_process_business_applications->business_processes FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_process_business_applications_application') THEN
            ALTER TABLE core.business_process_business_applications
                ADD CONSTRAINT fk_business_process_business_applications_application
                FOREIGN KEY (tenant_id, company_id, business_application_id)
                REFERENCES core.business_applications (tenant_id, company_id, business_application_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'business_process_business_applications: composite FK to business_applications added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'business_process_business_applications->business_applications FK skipped — %', SQLERRM; END;


    -- ============================================================
    -- SECTION D — single-column FKs (target table's key was not part of
    -- the Critical #2 composite rollout)
    -- ============================================================

    -- table_columns → tables (CASCADE: junction row is meaningless without
    -- the table) and → columns (RESTRICT: protect the shared column-name
    -- catalog entry)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_table_columns_table') THEN
            ALTER TABLE core.table_columns
                ADD CONSTRAINT fk_table_columns_table
                FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'table_columns: FK to tables added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'table_columns->tables FK skipped — %', SQLERRM; END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_table_columns_column') THEN
            ALTER TABLE core.table_columns
                ADD CONSTRAINT fk_table_columns_column
                FOREIGN KEY (column_id) REFERENCES core.columns (column_id)
                ON DELETE RESTRICT NOT VALID;
            RAISE NOTICE 'table_columns: FK to columns added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'table_columns->columns FK skipped — %', SQLERRM; END;

    -- tool_tables → tables (CASCADE); tool_id side deferred (README Low #4)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tool_tables_table') THEN
            ALTER TABLE core.tool_tables
                ADD CONSTRAINT fk_tool_tables_table
                FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'tool_tables: FK to tables added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'tool_tables->tables FK skipped — %', SQLERRM; END;

    -- risk_management.agent_risk_scenarios → agent_risk_assessment
    -- (CASCADE: a scenario has no meaning without its assessment)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_risk_scenarios_assessment') THEN
            ALTER TABLE risk_management.agent_risk_scenarios
                ADD CONSTRAINT fk_agent_risk_scenarios_assessment
                FOREIGN KEY (assessment_id) REFERENCES risk_management.agent_risk_assessment (assessment_id)
                ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'agent_risk_scenarios: FK to agent_risk_assessment added';
        END IF;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'agent_risk_scenarios->agent_risk_assessment FK skipped — %', SQLERRM; END;

END $$;
