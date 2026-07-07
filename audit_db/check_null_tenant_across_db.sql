SELECT
    table_name,
    total,
    missing_tenant_id,
    ROUND(missing_tenant_id * 100.0 / NULLIF(total, 0), 1) AS pct_missing
FROM (
    SELECT 'core.agents'                          AS table_name, COUNT(*) AS total, SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) AS missing_tenant_id FROM core.agents
    UNION ALL SELECT 'core.agent_configurations',            COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_configurations
    UNION ALL SELECT 'core.agent_controls',                  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_controls
    UNION ALL SELECT 'core.agent_ai_models',                 COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_ai_models
    UNION ALL SELECT 'core.agent_ai_use_cases',              COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_ai_use_cases
    UNION ALL SELECT 'core.agent_business_applications',     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_business_applications
    UNION ALL SELECT 'core.agent_business_integrations',     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_business_integrations
    UNION ALL SELECT 'core.agent_business_processes',        COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_business_processes
    UNION ALL SELECT 'core.agent_data_sources',              COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_data_sources
    UNION ALL SELECT 'core.agent_generated_code',            COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_generated_code
    UNION ALL SELECT 'core.agent_governance_events',         COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_governance_events
    UNION ALL SELECT 'core.agent_guardrails',                COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_guardrails
    UNION ALL SELECT 'core.agent_identifications',           COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_identifications
    UNION ALL SELECT 'core.agent_issues',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_issues
    UNION ALL SELECT 'core.agent_knowledge_sources',         COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_knowledge_sources
    UNION ALL SELECT 'core.agent_llm_models',                COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_llm_models
    UNION ALL SELECT 'core.agent_mcp_servers',               COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_mcp_servers
    UNION ALL SELECT 'core.agent_memories',                  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_memories
    UNION ALL SELECT 'core.agent_physical_ai',               COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_physical_ai
    UNION ALL SELECT 'core.agent_prompt_templates',          COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_prompt_templates
    UNION ALL SELECT 'core.agent_regulations_or_frameworks', COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_regulations_or_frameworks
    UNION ALL SELECT 'core.agent_resources',                 COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_resources
    UNION ALL SELECT 'core.agent_risk_assessments',          COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_risk_assessments
    UNION ALL SELECT 'core.agent_skills',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_skills
    UNION ALL SELECT 'core.agent_tables',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_tables
    UNION ALL SELECT 'core.agent_tools',                     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.agent_tools
    UNION ALL SELECT 'core.ai_model_ai_use_cases',           COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_model_ai_use_cases
    UNION ALL SELECT 'core.ai_model_business_applications',  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_model_business_applications
    UNION ALL SELECT 'core.ai_model_business_processes',     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_model_business_processes
    UNION ALL SELECT 'core.ai_models',                       COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_models
    UNION ALL SELECT 'core.ai_use_cases',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_use_cases
    UNION ALL SELECT 'core.ai_use_case_business_applications', COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_use_case_business_applications
    UNION ALL SELECT 'core.ai_use_case_business_processes',  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.ai_use_case_business_processes
    UNION ALL SELECT 'core.business_applications',           COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.business_applications
    UNION ALL SELECT 'core.business_integrations',           COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.business_integrations
    UNION ALL SELECT 'core.business_processes',              COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.business_processes
    UNION ALL SELECT 'core.columns',                         COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.columns
    UNION ALL SELECT 'core.issues',                          COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.issues
    UNION ALL SELECT 'core.playground_session',              COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.playground_session
    UNION ALL SELECT 'core.skills',                          COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.skills
    UNION ALL SELECT 'core.spark_ideas',                     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.spark_ideas
    UNION ALL SELECT 'core.tables',                          COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.tables
    UNION ALL SELECT 'core.table_columns',                   COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.table_columns
    UNION ALL SELECT 'core.tools',                           COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.tools
    UNION ALL SELECT 'core.tool_tables',                     COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM core.tool_tables
    UNION ALL SELECT 'curated.agent_360',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM curated.agent_360
    UNION ALL SELECT 'raw.agent_card_json',                  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM raw.agent_card_json
    UNION ALL SELECT 'raw.ingestion_log',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM raw.ingestion_log
    UNION ALL SELECT 'raw.run_time_logs',                    COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM raw.run_time_logs
    UNION ALL SELECT 'risk_management.agent_risk_assessment', COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM risk_management.agent_risk_assessment
    UNION ALL SELECT 'risk_management.agent_risk_scenarios',  COUNT(*), SUM(CASE WHEN tenant_id IS NULL OR tenant_id = '' THEN 1 ELSE 0 END) FROM risk_management.agent_risk_scenarios
) audit
WHERE missing_tenant_id > 0
ORDER BY missing_tenant_id DESC, table_name;