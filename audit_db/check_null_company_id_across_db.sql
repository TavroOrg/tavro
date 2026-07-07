SELECT table_name, total, missing_company_id, missing_company_name, both_missing, fully_populated,
            ROUND(fully_populated * 100.0 / NULLIF(total, 0), 1) AS pct_complete
        FROM (SELECT 'core.agent_ai_models' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_ai_models
UNION ALL
SELECT 'core.agent_ai_use_cases' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_ai_use_cases
UNION ALL
SELECT 'core.agent_business_applications' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_business_applications
UNION ALL
SELECT 'core.agent_business_integrations' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_business_integrations
UNION ALL
SELECT 'core.agent_business_processes' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_business_processes
UNION ALL
SELECT 'core.agent_configurations' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_configurations
UNION ALL
SELECT 'core.agent_controls' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_controls
UNION ALL
SELECT 'core.agent_data_sources' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_data_sources
UNION ALL
SELECT 'core.agent_generated_code' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_generated_code
UNION ALL
SELECT 'core.agent_governance_events' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_governance_events
UNION ALL
SELECT 'core.agent_guardrails' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_guardrails
UNION ALL
SELECT 'core.agent_identifications' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_identifications
UNION ALL
SELECT 'core.agent_issues' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_issues
UNION ALL
SELECT 'core.agent_knowledge_sources' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_knowledge_sources
UNION ALL
SELECT 'core.agent_llm_models' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_llm_models
UNION ALL
SELECT 'core.agent_mcp_servers' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_mcp_servers
UNION ALL
SELECT 'core.agent_memories' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_memories
UNION ALL
SELECT 'core.agent_physical_ai' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_physical_ai
UNION ALL
SELECT 'core.agent_prompt_templates' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_prompt_templates
UNION ALL
SELECT 'core.agent_regulations_or_frameworks' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_regulations_or_frameworks
UNION ALL
SELECT 'core.agent_resources' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_resources
UNION ALL
SELECT 'core.agent_risk_assessments' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_risk_assessments
UNION ALL
SELECT 'core.agent_tables' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_tables
UNION ALL
SELECT 'core.agent_tools' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agent_tools
UNION ALL
SELECT 'core.agents' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.agents
UNION ALL
SELECT 'core.ai_model_ai_use_cases' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_model_ai_use_cases
UNION ALL
SELECT 'core.ai_model_business_applications' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_model_business_applications
UNION ALL
SELECT 'core.ai_model_business_processes' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_model_business_processes
UNION ALL
SELECT 'core.ai_models' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_models
UNION ALL
SELECT 'core.ai_use_case_business_applications' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_use_case_business_applications
UNION ALL
SELECT 'core.ai_use_case_business_processes' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_use_case_business_processes
UNION ALL
SELECT 'core.ai_use_cases' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.ai_use_cases
UNION ALL
SELECT 'core.business_applications' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.business_applications
UNION ALL
SELECT 'core.business_integrations' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.business_integrations
UNION ALL
SELECT 'core.business_processes' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM core.business_processes
UNION ALL
SELECT 'core.columns' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.columns
UNION ALL
SELECT 'core.issues' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.issues
UNION ALL
SELECT 'core.playground_session' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.playground_session
UNION ALL
SELECT 'core.skills' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.skills
                
UNION ALL
SELECT 'core.spark_ideas' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.spark_ideas
UNION ALL
SELECT 'core.tables' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.tables
UNION ALL
SELECT 'core.tool_tables' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.tool_tables
UNION ALL
SELECT 'core.tools' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM core.tools
UNION ALL
SELECT 'curated.agent_360' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    SUM(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 ELSE 0 END) AS missing_company_name,
                    SUM(CASE WHEN (company_id IS NULL OR company_id = '') AND (company_name IS NULL OR company_name = '') THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN (company_id IS NOT NULL AND company_id <> '') AND (company_name IS NOT NULL AND company_name <> '') THEN 1 ELSE 0 END) AS fully_populated
                FROM curated.agent_360
UNION ALL
SELECT 'risk_management.agent_risk_assessment' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM risk_management.agent_risk_assessment
UNION ALL
SELECT 'risk_management.agent_risk_scenarios' AS table_name, COUNT(*) AS total,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS missing_company_id,
                    NULL::BIGINT AS missing_company_name,
                    SUM(CASE WHEN company_id IS NULL OR company_id = '' THEN 1 ELSE 0 END) AS both_missing,
                    SUM(CASE WHEN company_id IS NOT NULL AND company_id <> '' THEN 1 ELSE 0 END) AS fully_populated
                FROM risk_management.agent_risk_scenarios
                ) audit
        ORDER BY missing_company_id DESC, table_name