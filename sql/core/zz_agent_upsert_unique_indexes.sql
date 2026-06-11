CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agents_current
ON core.agents (agent_id, agent_name)
WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agents_internal_id
ON core.agents (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_configurations_current
ON core.agent_configurations (agent_internal_id)
WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_identifications_current
ON core.agent_identifications (agent_internal_id)
WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_tools
ON core.agent_tools (agent_internal_id, tool_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_controls
ON core.agent_controls (agent_internal_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_knowledge_sources
ON core.agent_knowledge_sources (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_llm_models
ON core.agent_llm_models (agent_internal_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_business_processes
ON core.agent_business_processes (agent_internal_id, business_process_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_business_applications
ON core.agent_business_applications (agent_internal_id, business_application_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_guardrails
ON core.agent_guardrails (agent_internal_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_mcp_servers
ON core.agent_mcp_servers (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_memories
ON core.agent_memories (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_physical_ai
ON core.agent_physical_ai (agent_internal_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_prompt_templates
ON core.agent_prompt_templates (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_regulations_or_frameworks
ON core.agent_regulations_or_frameworks (agent_internal_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_ai_models
ON core.agent_ai_models (agent_internal_id, ai_model_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_models
ON core.ai_models (ai_model_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_data_sources
ON core.agent_data_sources (agent_internal_id, source_object_id, target_object_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_issues
ON core.issues (tenant_id, identifier);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_issues
ON core.agent_issues (tenant_id, identifier, agent_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_business_applications
ON core.business_applications (business_application_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_business_processes
ON core.business_processes (business_process_id);

-- ux_core_columns removed: column_id is now the PRIMARY KEY

-- ux_core_tables removed: table_id is already the PRIMARY KEY

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_tool_tables
ON core.tool_tables (tenant_id, tool_id, table_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_tables
ON core.agent_tables (tenant_id, agent_id, table_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_table_columns
ON core.table_columns (tenant_id, table_id, column_name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_skills
ON core.skills (tenant_id, skill_id);

DO $$
BEGIN
    IF to_regclass('core.tables') IS NOT NULL THEN
        ALTER TABLE core.tables DROP CONSTRAINT IF EXISTS fk_core_tables_agent_tool;
        DROP INDEX IF EXISTS core.ix_core_tables_agent_tool;

        IF to_regclass('core.agent_tables') IS NOT NULL
           AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'tables' AND column_name = 'agent_id'
           )
        THEN
            EXECUTE '
                INSERT INTO core.agent_tables (
                    tenant_id, agent_id, agent_name, agent_internal_id,
                    table_id, table_name, created_ts, updated_ts
                )
                SELECT
                    t.tenant_id,
                    t.agent_id,
                    ag.agent_name,
                    t.agent_internal_id,
                    t.table_id,
                    t.name,
                    COALESCE(t.created_ts, CURRENT_TIMESTAMP),
                    CURRENT_TIMESTAMP
                FROM core.tables t
                LEFT JOIN core.agents ag
                  ON ag.agent_id = t.agent_id
                 AND ag.agent_internal_id = t.agent_internal_id
                WHERE t.agent_id IS NOT NULL
                  AND t.agent_id <> ''''
                ON CONFLICT (tenant_id, agent_id, table_id) DO UPDATE SET
                    agent_name = COALESCE(EXCLUDED.agent_name, core.agent_tables.agent_name),
                    agent_internal_id = EXCLUDED.agent_internal_id,
                    table_name = COALESCE(EXCLUDED.table_name, core.agent_tables.table_name),
                    updated_ts = EXCLUDED.updated_ts
            ';
        END IF;

        IF to_regclass('core.tool_tables') IS NOT NULL
           AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'tables' AND column_name = 'tool_id'
           )
        THEN
            EXECUTE '
                INSERT INTO core.tool_tables (
                    tenant_id, tool_id, tool_name, table_id, table_name,
                    created_ts, updated_ts
                )
                SELECT
                    t.tenant_id,
                    t.tool_id,
                    at.tool_name,
                    t.table_id,
                    t.name,
                    COALESCE(t.created_ts, CURRENT_TIMESTAMP),
                    CURRENT_TIMESTAMP
                FROM core.tables t
                LEFT JOIN core.agent_tools at
                  ON at.tool_id = t.tool_id
                 AND at.agent_internal_id = t.agent_internal_id
                WHERE t.tool_id IS NOT NULL
                  AND t.tool_id <> ''''
                ON CONFLICT (tenant_id, tool_id, table_id) DO UPDATE SET
                    tool_name = COALESCE(EXCLUDED.tool_name, core.tool_tables.tool_name),
                    table_name = COALESCE(EXCLUDED.table_name, core.tool_tables.table_name),
                    updated_ts = EXCLUDED.updated_ts
            ';
        END IF;

        IF to_regclass('core.tool_tables') IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'tool_tables' AND column_name = 'agent_id'
            ) THEN
                ALTER TABLE core.tool_tables DROP COLUMN agent_id;
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'tool_tables' AND column_name = 'agent_internal_id'
            ) THEN
                ALTER TABLE core.tool_tables DROP COLUMN agent_internal_id;
            END IF;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'tables' AND column_name = 'agent_id'
        ) THEN
            ALTER TABLE core.tables DROP COLUMN agent_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'tables' AND column_name = 'tool_id'
        ) THEN
            ALTER TABLE core.tables DROP COLUMN tool_id;
        END IF;
    END IF;

    IF to_regclass('core.agent_ai_use_cases') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'ai_use_case_id'
        ) THEN
            ALTER TABLE core.agent_ai_use_cases ADD COLUMN ai_use_case_id TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'ai_use_case_name'
        ) THEN
            ALTER TABLE core.agent_ai_use_cases ADD COLUMN ai_use_case_name TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'agent_name'
        ) THEN
            ALTER TABLE core.agent_ai_use_cases ADD COLUMN agent_name TEXT;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'identifier'
        ) THEN
            EXECUTE '
                UPDATE core.agent_ai_use_cases
                SET ai_use_case_id = COALESCE(NULLIF(ai_use_case_id, ''''), NULLIF(identifier, ''''))
                WHERE COALESCE(ai_use_case_id, '''') = ''''
            ';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'name'
        ) THEN
            EXECUTE '
                UPDATE core.agent_ai_use_cases
                SET ai_use_case_name = COALESCE(NULLIF(ai_use_case_name, ''''), NULLIF(name, ''''))
                WHERE COALESCE(ai_use_case_name, '''') = ''''
            ';
        END IF;

        UPDATE core.agent_ai_use_cases rel
        SET agent_name = COALESCE(NULLIF(rel.agent_name, ''), ag.agent_name)
        FROM core.agents ag
        WHERE rel.agent_id = ag.agent_id
          AND COALESCE(ag.is_current, true) = true;
    END IF;

    IF to_regclass('core.ai_use_cases') IS NOT NULL
       AND to_regclass('core.agent_ai_use_cases') IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_use_cases' AND column_name = 'identifier'
       )
    THEN
        EXECUTE '
            INSERT INTO core.ai_use_cases (
                tenant_id, ai_use_case_id, name, description, proposed_by, owner, function,
                problem_statement, expected_benefits, priority, status,
                created_ts, updated_ts, agent_internal_id,
                agent_risk_exposure_are, no_of_associated_agents,
                inherent_risk_classification, residual_risk_classification,
                agent_risk_tier_art, blended_risk_score,
                inherent_risk_classification_score, residual_risk_classification_score,
                solution_approach
            )
            SELECT DISTINCT ON (tenant_id, identifier)
                tenant_id, identifier, name, description, proposed_by, owner, function,
                problem_statement, expected_benefits, priority, status,
                created_ts, updated_ts, agent_internal_id,
                agent_risk_exposure_are, no_of_associated_agents,
                inherent_risk_classification, residual_risk_classification,
                agent_risk_tier_art, blended_risk_score,
                inherent_risk_classification_score, residual_risk_classification_score,
                solution_approach
            FROM core.agent_ai_use_cases
            WHERE identifier IS NOT NULL
              AND identifier <> ''''
            ORDER BY tenant_id, identifier, updated_ts DESC NULLS LAST, created_ts DESC NULLS LAST
            ON CONFLICT (tenant_id, ai_use_case_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                proposed_by = EXCLUDED.proposed_by,
                owner = EXCLUDED.owner,
                function = EXCLUDED.function,
                problem_statement = EXCLUDED.problem_statement,
                expected_benefits = EXCLUDED.expected_benefits,
                priority = EXCLUDED.priority,
                status = EXCLUDED.status,
                updated_ts = EXCLUDED.updated_ts,
                agent_internal_id = EXCLUDED.agent_internal_id,
                agent_risk_exposure_are = EXCLUDED.agent_risk_exposure_are,
                no_of_associated_agents = EXCLUDED.no_of_associated_agents,
                inherent_risk_classification = EXCLUDED.inherent_risk_classification,
                residual_risk_classification = EXCLUDED.residual_risk_classification,
                agent_risk_tier_art = EXCLUDED.agent_risk_tier_art,
                blended_risk_score = EXCLUDED.blended_risk_score,
                inherent_risk_classification_score = EXCLUDED.inherent_risk_classification_score,
                residual_risk_classification_score = EXCLUDED.residual_risk_classification_score,
                solution_approach = EXCLUDED.solution_approach
        ';
    END IF;

    IF to_regclass('core.ai_use_cases') IS NOT NULL THEN
        DELETE FROM core.ai_use_cases a
        USING core.ai_use_cases b
        WHERE COALESCE(a.tenant_id, '') = COALESCE(b.tenant_id, '')
          AND COALESCE(a.ai_use_case_id, '') = COALESCE(b.ai_use_case_id, '')
          AND a.ctid < b.ctid;
    END IF;

    IF to_regclass('core.agent_skills') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_skills' AND column_name = 'skill_id'
        ) THEN
            ALTER TABLE core.agent_skills ADD COLUMN skill_id TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_skills' AND column_name = 'skill_name'
        ) THEN
            ALTER TABLE core.agent_skills ADD COLUMN skill_name TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_skills' AND column_name = 'agent_name'
        ) THEN
            ALTER TABLE core.agent_skills ADD COLUMN agent_name TEXT;
        END IF;

        UPDATE core.agent_skills rel
        SET agent_name = COALESCE(NULLIF(rel.agent_name, ''), ag.agent_name)
        FROM core.agents ag
        WHERE rel.agent_id = ag.agent_id
          AND COALESCE(ag.is_current, true) = true;

        DELETE FROM core.agent_skills a
        USING core.agent_skills b
        WHERE COALESCE(a.tenant_id, '') = COALESCE(b.tenant_id, '')
          AND COALESCE(a.skill_id, '') = COALESCE(b.skill_id, '')
          AND COALESCE(a.agent_id, '') = COALESCE(b.agent_id, '')
          AND a.ctid < b.ctid;
    END IF;

    IF to_regclass('core.skills') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'skills' AND column_name = 'tags'
        ) THEN
            ALTER TABLE core.skills ADD COLUMN tags TEXT[];
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'skills' AND column_name = 'input_modes'
        ) THEN
            ALTER TABLE core.skills ADD COLUMN input_modes TEXT[];
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'skills' AND column_name = 'output_modes'
        ) THEN
            ALTER TABLE core.skills ADD COLUMN output_modes TEXT[];
        END IF;
    END IF;

    IF to_regclass('core.agent_ai_use_cases') IS NOT NULL THEN
        DELETE FROM core.agent_ai_use_cases a
        USING core.agent_ai_use_cases b
        WHERE COALESCE(a.tenant_id, '') = COALESCE(b.tenant_id, '')
          AND COALESCE(a.ai_use_case_id, '') = COALESCE(b.ai_use_case_id, '')
          AND COALESCE(a.agent_id, '') = COALESCE(b.agent_id, '')
          AND a.ctid < b.ctid;
    END IF;

    IF to_regclass('core.ai_use_cases') IS NOT NULL THEN
        DROP INDEX IF EXISTS core.ux_core_ai_use_cases;
        CREATE UNIQUE INDEX ux_core_ai_use_cases
        ON core.ai_use_cases (tenant_id, ai_use_case_id);
    END IF;

    IF to_regclass('core.agent_ai_use_cases') IS NOT NULL THEN
        DROP INDEX IF EXISTS core.ux_core_agent_ai_use_cases;
        CREATE UNIQUE INDEX ux_core_agent_ai_use_cases
        ON core.agent_ai_use_cases (tenant_id, ai_use_case_id, agent_id);
    END IF;

    IF to_regclass('core.agent_skills') IS NOT NULL THEN
        DROP INDEX IF EXISTS core.ux_core_agent_skills;
        CREATE UNIQUE INDEX ux_core_agent_skills
        ON core.agent_skills (tenant_id, skill_id, agent_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_core_agent_business_applications_business_application'
    ) THEN
        ALTER TABLE core.agent_business_applications
        ADD CONSTRAINT fk_core_agent_business_applications_business_application
        FOREIGN KEY (business_application_id)
        REFERENCES core.business_applications (business_application_id)
        ON DELETE CASCADE;
    END IF;

    -- Create helper function + triggers to populate tenant_id on insert when missing
    IF to_regclass('core.agents') IS NOT NULL THEN
        EXECUTE $ddl$
        CREATE OR REPLACE FUNCTION core.populate_tenant_from_agent() RETURNS trigger AS $func$
        BEGIN
            -- For rows that include agent_internal_id, prefer that lookup
            IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' THEN
                IF TG_TABLE_NAME = 'agent_tools' THEN
                    IF NEW.agent_internal_id IS NOT NULL THEN
                        SELECT tenant_id INTO NEW.tenant_id FROM core.agents WHERE agent_internal_id = NEW.agent_internal_id LIMIT 1;
                    END IF;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
        $ddl$;

        -- Attach triggers to relevant tables
        IF to_regclass('core.agent_tools') IS NOT NULL THEN
            EXECUTE 'DROP TRIGGER IF EXISTS trg_populate_tenant_agent_tools ON core.agent_tools';
            EXECUTE 'CREATE TRIGGER trg_populate_tenant_agent_tools BEFORE INSERT OR UPDATE ON core.agent_tools FOR EACH ROW EXECUTE FUNCTION core.populate_tenant_from_agent()';
        END IF;

        IF to_regclass('core.tables') IS NOT NULL THEN
            EXECUTE 'DROP TRIGGER IF EXISTS trg_populate_tenant_tables ON core.tables';
            EXECUTE 'CREATE TRIGGER trg_populate_tenant_tables BEFORE INSERT OR UPDATE ON core.tables FOR EACH ROW EXECUTE FUNCTION core.populate_tenant_from_agent()';
        END IF;

        IF to_regclass('core.columns') IS NOT NULL THEN
            EXECUTE 'DROP TRIGGER IF EXISTS trg_populate_tenant_columns ON core.columns';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_core_agent_business_processes_business_process'
    ) THEN
        ALTER TABLE core.agent_business_processes
        ADD CONSTRAINT fk_core_agent_business_processes_business_process
        FOREIGN KEY (business_process_id)
        REFERENCES core.business_processes (business_process_id)
        ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_core_business_processes_parent'
    ) THEN
        ALTER TABLE core.business_processes
        ADD CONSTRAINT fk_core_business_processes_parent
        FOREIGN KEY (parent_process_id)
        REFERENCES core.business_processes (business_process_id)
        ON DELETE SET NULL;
    END IF;

    IF to_regclass('core.ai_use_case_business_processes') IS NOT NULL THEN
        EXECUTE '
            CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_use_case_business_processes
            ON core.ai_use_case_business_processes (ai_use_case_id, business_process_id, tenant_id)
        ';

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_core_ai_use_case_business_processes_business_process'
        ) THEN
            ALTER TABLE core.ai_use_case_business_processes
            ADD CONSTRAINT fk_core_ai_use_case_business_processes_business_process
            FOREIGN KEY (business_process_id)
            REFERENCES core.business_processes (business_process_id)
            ON DELETE CASCADE;
        END IF;
    END IF;

    -- Rename issue_id → identifier on core.issues and core.agent_issues
    IF to_regclass('core.issues') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'issue_id'
        ) THEN
            ALTER TABLE core.issues RENAME COLUMN issue_id TO identifier;
        END IF;
    END IF;

    IF to_regclass('core.agent_issues') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_issues' AND column_name = 'issue_id'
        ) THEN
            ALTER TABLE core.agent_issues RENAME COLUMN issue_id TO identifier;
        END IF;
    END IF;

    -- Drop and recreate unique indexes with new column name
    IF to_regclass('core.issues') IS NOT NULL THEN
        DROP INDEX IF EXISTS core.ux_core_issues;
        CREATE UNIQUE INDEX IF NOT EXISTS ux_core_issues ON core.issues (tenant_id, identifier);
    END IF;

    IF to_regclass('core.agent_issues') IS NOT NULL THEN
        DROP INDEX IF EXISTS core.ux_core_agent_issues;
        CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_issues ON core.agent_issues (tenant_id, identifier, agent_id);
    END IF;

    -- Migrate core.issues to new schema
    IF to_regclass('core.issues') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'title'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN title TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'description'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN description TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'issue_type'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN issue_type TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'severity'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN severity TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'source'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN source TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'detected_at'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN detected_at TIMESTAMP;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'resolved_at'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN resolved_at TIMESTAMP;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'status'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN status TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'resolution_notes'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN resolution_notes TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'assignee'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN assignee TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'owner'
        ) THEN
            ALTER TABLE core.issues ADD COLUMN owner TEXT;
        END IF;

        -- Migrate data from old columns to new ones
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'issue_name'
        ) THEN
            UPDATE core.issues SET title = COALESCE(NULLIF(title, ''), issue_name) WHERE COALESCE(title, '') = '';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'assigned_to'
        ) THEN
            UPDATE core.issues SET assignee = COALESCE(NULLIF(assignee, ''), assigned_to) WHERE COALESCE(assignee, '') = '';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'reported_date'
        ) THEN
            UPDATE core.issues SET detected_at = COALESCE(detected_at, reported_date) WHERE detected_at IS NULL;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'issues' AND column_name = 'mitigation_state'
        ) THEN
            UPDATE core.issues SET status = COALESCE(NULLIF(status, ''), mitigation_state) WHERE COALESCE(status, '') = '';
        END IF;
    END IF;

    -- Migrate core.agent_issues to use title instead of issue_name
    IF to_regclass('core.agent_issues') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_issues' AND column_name = 'title'
        ) THEN
            ALTER TABLE core.agent_issues ADD COLUMN title TEXT;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_issues' AND column_name = 'issue_name'
        ) THEN
            UPDATE core.agent_issues SET title = COALESCE(NULLIF(title, ''), issue_name) WHERE COALESCE(title, '') = '';
        END IF;
    END IF;

    IF to_regclass('core.table_columns') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'table_columns' AND column_name = 'column_id'
       )
    THEN
        ALTER TABLE core.table_columns ADD COLUMN column_id TEXT;
    END IF;

    IF to_regclass('core.columns') IS NOT NULL THEN
        ALTER TABLE core.columns DROP CONSTRAINT IF EXISTS fk_core_columns_table;
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'columns' AND column_name = 'column_id'
        ) THEN
            ALTER TABLE core.columns ADD COLUMN column_id TEXT;
            UPDATE core.columns SET column_id = gen_random_uuid()::text WHERE column_id IS NULL;
            ALTER TABLE core.columns ADD PRIMARY KEY (column_id);
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'columns' AND column_name = 'table_id'
        ) THEN
            ALTER TABLE core.columns DROP COLUMN table_id;
        END IF;
    END IF;

    IF to_regclass('core.tables') IS NOT NULL THEN
        ALTER TABLE core.tables DROP CONSTRAINT IF EXISTS fk_core_tables_agent;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'tables' AND column_name = 'agent_internal_id'
        ) THEN
            ALTER TABLE core.tables DROP COLUMN agent_internal_id;
        END IF;
    END IF;

    IF to_regclass('core.ai_use_case_business_applications') IS NOT NULL THEN
        EXECUTE '
            CREATE UNIQUE INDEX IF NOT EXISTS ux_core_ai_use_case_business_applications
            ON core.ai_use_case_business_applications (ai_use_case_id, business_application_id, tenant_id)
        ';

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_core_ai_use_case_business_applications_business_application'
        ) THEN
            ALTER TABLE core.ai_use_case_business_applications
            ADD CONSTRAINT fk_core_ai_use_case_business_applications_business_application
            FOREIGN KEY (business_application_id)
            REFERENCES core.business_applications (business_application_id)
            ON DELETE CASCADE;
        END IF;
    END IF;

    -- AI Models junction: ensure agent_name exists for display (additive).
    IF to_regclass('core.agent_ai_models') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agent_ai_models'
            AND column_name = 'agent_name'
        ) THEN
            ALTER TABLE core.agent_ai_models ADD COLUMN agent_name TEXT;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_core_agent_ai_models_ai_model'
        ) THEN
            ALTER TABLE core.agent_ai_models
            ADD CONSTRAINT fk_core_agent_ai_models_ai_model
            FOREIGN KEY (ai_model_id)
            REFERENCES core.ai_models (ai_model_id)
            ON DELETE CASCADE;
        END IF;
    END IF;

    -- Agent-to-agent (parent/child) self-reference on core.agents.
    -- Mirrors business_processes.parent_process_id. No FK is added because
    -- core.agents is versioned (agent_internal_id is not unique), so it cannot
    -- be used as a foreign-key target.
    IF to_regclass('core.agents') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'agents'
              AND column_name = 'parent_agent_internal_id'
        ) THEN
            ALTER TABLE core.agents ADD COLUMN parent_agent_internal_id TEXT;
        END IF;

        CREATE INDEX IF NOT EXISTS ix_core_agents_parent_internal_id
        ON core.agents (parent_agent_internal_id);
    END IF;

END $$;
