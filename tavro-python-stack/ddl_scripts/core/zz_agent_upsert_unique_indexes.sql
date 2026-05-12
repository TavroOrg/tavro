CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agents_current
ON core.agents (agent_id, agent_name)
WHERE is_current = true;

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

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_ai_use_cases
ON core.agent_ai_use_cases (agent_internal_id, name);

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
ON core.agent_ai_models (agent_internal_id, model_name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_agent_data_sources
ON core.agent_data_sources (agent_internal_id, source_object_id, target_object_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_business_applications
ON core.business_applications (business_application_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_business_processes
ON core.business_processes (business_process_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_core_business_process_relationships
ON core.business_process_relationships (business_process_id, related_business_process_id, relationship_type);

INSERT INTO core.business_applications (
    business_application_id, agent_id, agent_internal_id, application_name, business_criticality, created_ts, updated_ts
)
SELECT
    business_application_id,
    MAX(agent_id) AS agent_id,
    MAX(agent_internal_id) AS agent_internal_id,
    MAX(application_name) AS application_name,
    MAX(criticality) AS business_criticality,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM core.agent_business_applications
WHERE business_application_id IS NOT NULL
GROUP BY business_application_id
ON CONFLICT (business_application_id)
DO UPDATE SET
    agent_id = COALESCE(EXCLUDED.agent_id, core.business_applications.agent_id),
    agent_internal_id = COALESCE(EXCLUDED.agent_internal_id, core.business_applications.agent_internal_id),
    application_name = COALESCE(EXCLUDED.application_name, core.business_applications.application_name),
    business_criticality = COALESCE(EXCLUDED.business_criticality, core.business_applications.business_criticality),
    updated_ts = CURRENT_TIMESTAMP;

INSERT INTO core.business_processes (
    business_process_id, agent_id, agent_internal_id, process_number, process_name, business_criticality, created_ts, updated_ts
)
SELECT
    business_process_id,
    MAX(agent_id) AS agent_id,
    MAX(agent_internal_id) AS agent_internal_id,
    business_process_id AS process_number,
    MAX(process_name) AS process_name,
    MAX(criticality) AS business_criticality,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM core.agent_business_processes
WHERE business_process_id IS NOT NULL
GROUP BY business_process_id
ON CONFLICT (business_process_id)
DO UPDATE SET
    agent_id = COALESCE(EXCLUDED.agent_id, core.business_processes.agent_id),
    agent_internal_id = COALESCE(EXCLUDED.agent_internal_id, core.business_processes.agent_internal_id),
    process_name = COALESCE(EXCLUDED.process_name, core.business_processes.process_name),
    business_criticality = COALESCE(EXCLUDED.business_criticality, core.business_processes.business_criticality),
    updated_ts = CURRENT_TIMESTAMP;

INSERT INTO core.business_processes (
    business_process_id, agent_id, agent_internal_id, process_number, created_ts, updated_ts
)
SELECT
    rel.process_id,
    (SELECT MAX(abp.agent_id) FROM core.agent_business_processes abp WHERE abp.business_process_id = rel.process_id) AS agent_id,
    (SELECT MAX(abp.agent_internal_id) FROM core.agent_business_processes abp WHERE abp.business_process_id = rel.process_id) AS agent_internal_id,
    rel.process_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT business_process_id AS process_id
    FROM core.business_process_relationships
    WHERE business_process_id IS NOT NULL
    UNION
    SELECT related_business_process_id AS process_id
    FROM core.business_process_relationships
    WHERE related_business_process_id IS NOT NULL
) rel
ON CONFLICT (business_process_id)
DO UPDATE SET
    agent_id = COALESCE(core.business_processes.agent_id, EXCLUDED.agent_id),
    agent_internal_id = COALESCE(core.business_processes.agent_internal_id, EXCLUDED.agent_internal_id),
    updated_ts = CURRENT_TIMESTAMP;

DO $$
BEGIN
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

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_core_business_process_relationships_process'
    ) THEN
        ALTER TABLE core.business_process_relationships
        ADD CONSTRAINT fk_core_business_process_relationships_process
        FOREIGN KEY (business_process_id)
        REFERENCES core.business_processes (business_process_id)
        ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_core_business_process_relationships_related_process'
    ) THEN
        ALTER TABLE core.business_process_relationships
        ADD CONSTRAINT fk_core_business_process_relationships_related_process
        FOREIGN KEY (related_business_process_id)
        REFERENCES core.business_processes (business_process_id)
        ON DELETE CASCADE;
    END IF;
END $$;
