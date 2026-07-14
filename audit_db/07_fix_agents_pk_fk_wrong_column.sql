-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- ONE-TIME REPAIR — only needed if 02_fix/03_critical/04_high were run
-- BEFORE 01_rename on this database (the order this repo originally,
-- incorrectly, documented). If you're running the full sequence fresh in
-- the corrected 01→06 order, you will never hit this bug and this file
-- is a no-op everywhere it checks.
--
-- ROOT CAUSE: 02_fix/03_critical/04_high's SQL text says "agent_id"
-- literally, meaning "the post-rename canonical identity." If they run
-- BEFORE 01_rename, "agent_id" at that moment still means the OLD
-- business-key column — so pk_core_agents, ux_core_agents_current, and
-- every FK referencing core.agents end up built on the wrong physical
-- column. Postgres's rename is attnum-based, so it silently carries
-- those constraints forward onto the renamed agent_source_id column
-- afterward instead of erroring — the mistake is invisible until you
-- inspect \d core.agents directly.
--
-- THIS SCRIPT: rebuilds pk_core_agents, ux_core_agents_current, and
-- every FK referencing core.agents on agent_id instead of
-- agent_source_id. Detects the wrong-column state by definition text
-- (not just presence), so it's a no-op if things are already correct.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - Requires agent_id to have zero NULL values on core.agents (true on
--     every environment observed so far, since Section A of
--     03_critical_tenant_and_composite_pk.sql never touched agent_id's
--     nullability — only tenant_id/company_id). If some row does have a
--     NULL agent_id, the PK rebuild fails loudly and is NOT silently
--     skipped — that's a genuine data problem to fix first, not
--     something to paper over.
--   - Dropping pk_core_agents CASCADE only drops the dependent FK
--     objects (all ~23 of them, listed explicitly below and rebuilt in
--     the same breath) — never data.
--   - Idempotent: every step checks the CURRENT constraint definition,
--     not just whether a constraint with that name exists.
-- =============================================================

DO $$
BEGIN
    -- ux_core_agents_current
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'core' AND indexname = 'ux_core_agents_current'
          AND indexdef LIKE '%agent_source_id%'
    ) THEN
        DROP INDEX core.ux_core_agents_current;
        CREATE UNIQUE INDEX ux_core_agents_current
        ON core.agents (tenant_id, company_id, agent_id)
        WHERE is_current = true;
        RAISE NOTICE 'ux_core_agents_current: rebuilt on agent_id';
    END IF;
END $$;

DO $$
BEGIN
    -- pk_core_agents + every dependent FK
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pk_core_agents' AND pg_get_constraintdef(oid) LIKE '%agent_source_id%'
    ) THEN
        ALTER TABLE core.agents DROP CONSTRAINT pk_core_agents CASCADE;
        ALTER TABLE core.agents ADD CONSTRAINT pk_core_agents PRIMARY KEY (tenant_id, company_id, agent_id);

        ALTER TABLE core.agent_ai_models ADD CONSTRAINT fk_agent_ai_models_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_ai_use_cases ADD CONSTRAINT fk_agent_ai_use_cases_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_business_applications ADD CONSTRAINT fk_agent_business_applications_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_business_integrations ADD CONSTRAINT fk_agent_business_integrations_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_business_processes ADD CONSTRAINT fk_agent_business_processes_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_configurations ADD CONSTRAINT fk_agent_configurations_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_controls ADD CONSTRAINT fk_agent_controls_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_data_sources ADD CONSTRAINT fk_agent_data_sources_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_generated_code ADD CONSTRAINT fk_agent_generated_code_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_governance_events ADD CONSTRAINT fk_agent_governance_events_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE SET NULL NOT VALID;
        ALTER TABLE core.agent_guardrails ADD CONSTRAINT fk_agent_guardrails_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_identifications ADD CONSTRAINT fk_agent_identifications_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_issues ADD CONSTRAINT fk_agent_issues_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_knowledge_sources ADD CONSTRAINT fk_agent_knowledge_sources_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_llm_models ADD CONSTRAINT fk_agent_llm_models_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_mcp_servers ADD CONSTRAINT fk_agent_mcp_servers_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_memories ADD CONSTRAINT fk_agent_memories_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_physical_ai ADD CONSTRAINT fk_agent_physical_ai_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_prompt_templates ADD CONSTRAINT fk_agent_prompt_templates_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_regulations_or_frameworks ADD CONSTRAINT fk_agent_regulations_or_frameworks_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_risk_assessments ADD CONSTRAINT fk_agent_risk_assessments_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE RESTRICT NOT VALID;
        ALTER TABLE core.agent_tables ADD CONSTRAINT fk_agent_tables_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;
        ALTER TABLE core.agent_tools ADD CONSTRAINT fk_agent_tools_agent
            FOREIGN KEY (tenant_id, company_id, agent_id) REFERENCES core.agents (tenant_id, company_id, agent_id) ON DELETE CASCADE NOT VALID;

        RAISE NOTICE 'pk_core_agents: rebuilt on agent_id; all 23 dependent FKs rebuilt on agent_id';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pk_core_agents repair failed — %', SQLERRM;
END $$;
