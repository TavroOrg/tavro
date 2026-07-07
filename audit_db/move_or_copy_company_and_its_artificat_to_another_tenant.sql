DO $$
DECLARE
    -- ============================================================
    -- SET YOUR VALUES HERE
    -- ============================================================
    v_source_company_id TEXT := 'SOURCE_COMPANY_ID';  -- the company_id to move or copy
    v_source_tenant     TEXT := 'SOURCE_TENANT_ID';   -- the tenant_id where the company currently resides
    v_target_tenant     TEXT := 'TARGET_TENANT_ID';   -- the tenant_id where the company will be moved or copied to
    v_mode              TEXT := 'MOVE';              -- 'MOVE' or 'COPY'
    -- ============================================================

    v_twin_company_id   UUID;  -- derived from v_source_company_id

    v_tables TEXT[][] := ARRAY[
        -- core — master entities
        ARRAY['core', 'agents'],
        ARRAY['core', 'ai_use_cases'],
        ARRAY['core', 'ai_models'],
        ARRAY['core', 'business_applications'],
        ARRAY['core', 'business_integrations'],
        ARRAY['core', 'business_processes'],
        ARRAY['core', 'issues'],
        ARRAY['core', 'skills'],
        ARRAY['core', 'spark_ideas'],
        ARRAY['core', 'tables'],
        ARRAY['core', 'table_columns'],
        ARRAY['core', 'columns'],
        ARRAY['core', 'tools'],
        ARRAY['core', 'tool_tables'],
        ARRAY['core', 'playground_session'],
        -- core — agent detail
        ARRAY['core', 'agent_configurations'],
        ARRAY['core', 'agent_controls'],
        ARRAY['core', 'agent_ai_models'],
        ARRAY['core', 'agent_ai_use_cases'],
        ARRAY['core', 'agent_business_applications'],
        ARRAY['core', 'agent_business_integrations'],
        ARRAY['core', 'agent_business_processes'],
        ARRAY['core', 'agent_data_sources'],
        ARRAY['core', 'agent_generated_code'],
        ARRAY['core', 'agent_governance_events'],
        ARRAY['core', 'agent_guardrails'],
        ARRAY['core', 'agent_identifications'],
        ARRAY['core', 'agent_issues'],
        ARRAY['core', 'agent_knowledge_sources'],
        ARRAY['core', 'agent_llm_models'],
        ARRAY['core', 'agent_mcp_servers'],
        ARRAY['core', 'agent_memories'],
        ARRAY['core', 'agent_physical_ai'],
        ARRAY['core', 'agent_prompt_templates'],
        ARRAY['core', 'agent_regulations_or_frameworks'],
        ARRAY['core', 'agent_resources'],
        ARRAY['core', 'agent_risk_assessments'],
        ARRAY['core', 'agent_skills'],
        ARRAY['core', 'agent_tables'],
        ARRAY['core', 'agent_tools'],
        -- core — junction
        ARRAY['core', 'ai_model_ai_use_cases'],
        ARRAY['core', 'ai_model_business_applications'],
        ARRAY['core', 'ai_model_business_processes'],
        ARRAY['core', 'ai_use_case_business_applications'],
        ARRAY['core', 'ai_use_case_business_processes'],
        -- curated
        ARRAY['curated', 'agent_360'],
        -- risk_management
        ARRAY['risk_management', 'agent_risk_assessment'],
        ARRAY['risk_management', 'agent_risk_scenarios']
    ];

    v_entry           TEXT[];
    v_schema          TEXT;
    v_table           TEXT;
    v_rows            INT;
    v_count           INT;
    v_total           INT := 0;
    v_has_conflicts   BOOLEAN := FALSE;
    v_cols_select     TEXT;
    v_cols_insert     TEXT;
    v_has_company_id  BOOLEAN;
    v_new_company_uuid UUID;
    v_node_map        JSONB := '{}';
    v_node_rec        RECORD;
    v_new_id          UUID;

BEGIN

    -- Derive twin UUID from core company_id
    v_twin_company_id := v_source_company_id::UUID;

    -- ============================================================
    -- Validate inputs
    -- ============================================================
    IF v_mode NOT IN ('MOVE', 'COPY') THEN
        RAISE EXCEPTION 'v_mode must be MOVE or COPY. Got: %', v_mode;
    END IF;
    IF v_source_company_id IS NULL OR v_source_company_id = '' THEN
        RAISE EXCEPTION 'v_source_company_id cannot be blank.';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '========================================================';
    RAISE NOTICE 'MODE            : %', v_mode;
    RAISE NOTICE 'Company ID      : %', v_source_company_id;
    RAISE NOTICE 'Source tenant   : %', v_source_tenant;
    RAISE NOTICE 'Target tenant   : %', v_target_tenant;
    RAISE NOTICE '========================================================';

    -- ============================================================
    -- STEP 1 — Verify company exists in source tenant
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 1: Verify company exists in source tenant ---';

    SELECT COUNT(*) INTO v_count FROM (
        (SELECT 1 FROM core.agents                WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant LIMIT 1)
        UNION ALL
        (SELECT 1 FROM core.business_applications WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant LIMIT 1)
        UNION ALL
        (SELECT 1 FROM core.business_processes    WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant LIMIT 1)
        UNION ALL
        (SELECT 1 FROM core.business_integrations WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant LIMIT 1)
        UNION ALL
        (SELECT 1 FROM core.ai_use_cases          WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant LIMIT 1)
    ) chk;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Company % not found in source tenant %. Aborting.', v_source_company_id, v_source_tenant;
    END IF;
    RAISE NOTICE '[OK] Core company found in source tenant.';

    SELECT COUNT(*) INTO v_count FROM twin.company
    WHERE id = v_twin_company_id AND tenant_id = v_source_tenant;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'twin.company % not found in source tenant %. Aborting.', v_twin_company_id, v_source_tenant;
    END IF;
    RAISE NOTICE '[OK] twin.company found in source tenant.';

    -- ============================================================
    -- STEP 2 — Record counts in source tenant
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 2: Record counts in source tenant ---';
    RAISE NOTICE '';
    RAISE NOTICE '  [ core / curated / risk_management ]';
    v_total := 0;

    FOREACH v_entry SLICE 1 IN ARRAY v_tables LOOP
        v_schema := v_entry[1];
        v_table  := v_entry[2];

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_schema AND table_name = v_table AND column_name = 'company_id'
        ) INTO v_has_company_id;
        IF NOT v_has_company_id THEN CONTINUE; END IF;

        EXECUTE format('SELECT COUNT(*) FROM %I.%I WHERE company_id = %L AND tenant_id = %L',
            v_schema, v_table, v_source_company_id, v_source_tenant)
        INTO v_count;

        IF v_count > 0 THEN
            RAISE NOTICE '  %-44s : %', v_schema || '.' || v_table, v_count;
            v_total := v_total + v_count;
        END IF;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '  [ twin ]';

    SELECT COUNT(*) INTO v_count FROM twin.dim_node WHERE company_id = v_twin_company_id;
    RAISE NOTICE '  %-44s : %', 'twin.dim_node', v_count; v_total := v_total + v_count;

    SELECT COUNT(*) INTO v_count FROM twin.dim_edge e
    INNER JOIN twin.dim_node n ON n.id = e.source_id WHERE n.company_id = v_twin_company_id;
    RAISE NOTICE '  %-44s : %', 'twin.dim_edge', v_count; v_total := v_total + v_count;

    SELECT COUNT(*) INTO v_count FROM twin.source_ref sr
    INNER JOIN twin.dim_node n ON n.id = sr.dim_node_id WHERE n.company_id = v_twin_company_id;
    RAISE NOTICE '  %-44s : %', 'twin.source_ref', v_count; v_total := v_total + v_count;

    SELECT COUNT(*) INTO v_count FROM twin.dim_node_attachment da
    INNER JOIN twin.dim_node n ON n.id = da.node_id WHERE n.company_id = v_twin_company_id;
    RAISE NOTICE '  %-44s : %', 'twin.dim_node_attachment', v_count; v_total := v_total + v_count;

    SELECT COUNT(*) INTO v_count FROM twin.context_log WHERE company_id = v_twin_company_id;
    RAISE NOTICE '  %-44s : %', 'twin.context_log', v_count; v_total := v_total + v_count;

    RAISE NOTICE '';
    RAISE NOTICE '  [ public ]';

    SELECT COUNT(*) INTO v_count
    FROM public.agent_attachment aa
    INNER JOIN core.agents ag ON ag.agent_id = aa.agent_id
    WHERE ag.company_id = v_source_company_id AND ag.tenant_id = v_source_tenant
      AND COALESCE(ag.is_current, true) = true;
    RAISE NOTICE '  %-44s : %', 'public.agent_attachment', v_count; v_total := v_total + v_count;

    RAISE NOTICE '';
    RAISE NOTICE '  %-44s : %', 'TOTAL', v_total;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'No records found for this company in source tenant. Aborting.';
    END IF;

    -- ============================================================
    -- STEP 3 — Conflict checks
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 3: Conflict checks ---';

    IF v_mode = 'MOVE' THEN

        RAISE NOTICE '';
        RAISE NOTICE '  [ Entity-level unique key conflicts ]';

        SELECT COUNT(*) INTO v_count
        FROM core.agents s INNER JOIN core.agents t ON t.agent_internal_id = s.agent_internal_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.agents (agent_internal_id)               — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.agents'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.ai_models s INNER JOIN core.ai_models t ON t.ai_model_id = s.ai_model_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.ai_models (ai_model_id)                  — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.ai_models'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.tools s INNER JOIN core.tools t ON t.tool_id = s.tool_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.tools (tool_id)                          — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.tools'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.business_integrations s
        INNER JOIN core.business_integrations t ON t.integration_id = s.integration_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.business_integrations (integration_id)   — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.business_integrations'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM curated.agent_360 s
        INNER JOIN curated.agent_360 t ON t.agent_internal_id = s.agent_internal_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] curated.agent_360 (agent_internal_id)         — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] curated.agent_360'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM risk_management.agent_risk_assessment s
        INNER JOIN risk_management.agent_risk_assessment t ON t.assessment_id = s.assessment_id
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant AND t.tenant_id = v_target_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] risk_management.agent_risk_assessment         — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] risk_management.agent_risk_assessment'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM twin.company s
        INNER JOIN twin.company t
            ON lower(t.name) = lower(s.name) AND lower(t.region) = lower(s.region)
           AND t.tenant_id = v_target_tenant
        WHERE s.id = v_twin_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] twin.company (name, region, tenant_id)        — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] twin.company'; END IF;

        RAISE NOTICE '';
        RAISE NOTICE '  [ Tenant-keyed unique key conflicts ]';

        SELECT COUNT(*) INTO v_count
        FROM core.ai_use_cases s
        INNER JOIN core.ai_use_cases t ON t.ai_use_case_id = s.ai_use_case_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.ai_use_cases                             — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.ai_use_cases'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.business_applications s
        INNER JOIN core.business_applications t
            ON t.business_application_id = s.business_application_id
           AND t.company_id = s.company_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.business_applications                    — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.business_applications'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.business_processes s
        INNER JOIN core.business_processes t
            ON t.business_process_id = s.business_process_id
           AND t.company_id = s.company_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.business_processes                       — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.business_processes'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.skills s INNER JOIN core.skills t ON t.skill_id = s.skill_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.skills                                   — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.skills'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.issues s INNER JOIN core.issues t ON t.issue_id = s.issue_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.issues                                   — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.issues'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.agent_ai_use_cases s
        INNER JOIN core.agent_ai_use_cases t
            ON t.ai_use_case_id = s.ai_use_case_id AND t.agent_id = s.agent_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.agent_ai_use_cases                       — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.agent_ai_use_cases'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.agent_skills s
        INNER JOIN core.agent_skills t
            ON t.skill_id = s.skill_id AND t.agent_id = s.agent_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.agent_skills                             — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.agent_skills'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.agent_tables s
        INNER JOIN core.agent_tables t
            ON t.agent_id = s.agent_id AND t.table_id = s.table_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.agent_tables                             — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.agent_tables'; END IF;

        SELECT COUNT(*) INTO v_count
        FROM core.agent_issues s
        INNER JOIN core.agent_issues t
            ON t.issue_id = s.issue_id AND t.agent_id = s.agent_id AND t.tenant_id = v_target_tenant
        WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;
        IF v_count > 0 THEN v_has_conflicts := TRUE;
            RAISE NOTICE '  [CONFLICT] core.agent_issues                             — % collision(s)', v_count;
        ELSE RAISE NOTICE '  [OK] core.agent_issues'; END IF;

    ELSE -- COPY

        RAISE NOTICE '';
        RAISE NOTICE '  [ Checking if company already exists in target tenant ]';

        SELECT COUNT(*) INTO v_count FROM (
            (SELECT 1 FROM core.agents                WHERE company_id = v_source_company_id AND tenant_id = v_target_tenant LIMIT 1)
            UNION ALL
            (SELECT 1 FROM core.business_applications WHERE company_id = v_source_company_id AND tenant_id = v_target_tenant LIMIT 1)
            UNION ALL
            (SELECT 1 FROM core.business_processes    WHERE company_id = v_source_company_id AND tenant_id = v_target_tenant LIMIT 1)
        ) chk;
        IF v_count > 0 THEN
            RAISE NOTICE '  [WARNING] Core company already partially in target tenant. Overlapping rows will be skipped.';
        ELSE
            RAISE NOTICE '  [OK] Core company not yet in target tenant.';
        END IF;

        SELECT COUNT(*) INTO v_count
        FROM twin.company s
        INNER JOIN twin.company t
            ON lower(t.name) = lower(s.name) AND lower(t.region) = lower(s.region)
           AND t.tenant_id = v_target_tenant
        WHERE s.id = v_twin_company_id;
        IF v_count > 0 THEN
            RAISE NOTICE '  [WARNING] twin.company already exists in target tenant (same name+region). Twin COPY will be skipped.';
        ELSE
            RAISE NOTICE '  [OK] twin.company not yet in target tenant.';
        END IF;

    END IF;

    -- Abort MOVE on conflicts
    IF v_mode = 'MOVE' AND v_has_conflicts THEN
        RAISE NOTICE '';
        RAISE NOTICE '========================================================';
        RAISE NOTICE 'ABORTED — conflicts detected. Resolve above and re-run.';
        RAISE NOTICE 'No changes have been made.';
        RAISE NOTICE '========================================================';
        RAISE EXCEPTION 'Conflict check failed.';
    END IF;

    -- ============================================================
    -- STEP 4 — Execute
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================================';
    RAISE NOTICE '% starting...', v_mode;
    RAISE NOTICE '========================================================';
    v_total := 0;

    -- ──────────────────────────────────────────────────────────
    -- Core / curated / risk_management
    -- ──────────────────────────────────────────────────────────
    RAISE NOTICE '';
    RAISE NOTICE '  [ core / curated / risk_management ]';

    FOREACH v_entry SLICE 1 IN ARRAY v_tables LOOP
        v_schema := v_entry[1];
        v_table  := v_entry[2];

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_schema AND table_name = v_table AND column_name = 'company_id'
        ) INTO v_has_company_id;
        IF NOT v_has_company_id THEN CONTINUE; END IF;

        IF v_mode = 'MOVE' THEN
            EXECUTE format(
                'UPDATE %I.%I SET tenant_id = %L WHERE company_id = %L AND tenant_id = %L',
                v_schema, v_table, v_target_tenant, v_source_company_id, v_source_tenant
            );
        ELSE -- COPY
            SELECT
                string_agg(
                    CASE WHEN column_name = 'tenant_id'
                         THEN quote_literal(v_target_tenant)
                         ELSE quote_ident(column_name)
                    END, ', ' ORDER BY ordinal_position
                ),
                string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
            INTO v_cols_select, v_cols_insert
            FROM information_schema.columns
            WHERE table_schema = v_schema AND table_name = v_table;

            EXECUTE format(
                'INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I WHERE company_id = %L AND tenant_id = %L ON CONFLICT DO NOTHING',
                v_schema, v_table, v_cols_insert, v_cols_select,
                v_schema, v_table, v_source_company_id, v_source_tenant
            );
        END IF;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
            RAISE NOTICE '  %-44s : % row(s)', v_schema || '.' || v_table, v_rows;
            v_total := v_total + v_rows;
        END IF;
    END LOOP;

    -- ──────────────────────────────────────────────────────────
    -- Twin schema
    -- ──────────────────────────────────────────────────────────
    RAISE NOTICE '';
    RAISE NOTICE '  [ twin ]';

    IF v_mode = 'MOVE' THEN

        UPDATE twin.company
        SET tenant_id = v_target_tenant, updated_at = NOW()
        WHERE id = v_twin_company_id AND tenant_id = v_source_tenant;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RAISE NOTICE '  %-44s : % row(s)  (child tables cascade via UUID FK)', 'twin.company', v_rows;
        v_total := v_total + v_rows;

    ELSE -- COPY

        v_new_company_uuid := NULL;
        INSERT INTO twin.company (id, name, industry, region, legal_entity, tenant_id, created_at, updated_at)
        SELECT gen_random_uuid(), name, industry, region, legal_entity, v_target_tenant, NOW(), NOW()
        FROM twin.company
        WHERE id = v_twin_company_id AND tenant_id = v_source_tenant
        ON CONFLICT (lower(name), lower(region), tenant_id) DO NOTHING
        RETURNING id INTO v_new_company_uuid;

        IF v_new_company_uuid IS NULL THEN
            RAISE NOTICE '  %-44s : SKIPPED — already exists in target tenant', 'twin.company';
            RAISE NOTICE '  NOTE: twin child tables also skipped — resolve twin.company conflict first.';
        ELSE
            RAISE NOTICE '  %-44s : 1 row  → new id: %', 'twin.company', v_new_company_uuid;
            v_total := v_total + 1;

            -- Copy dim_nodes, build old→new UUID map
            v_node_map := '{}';
            FOR v_node_rec IN
                SELECT * FROM twin.dim_node WHERE company_id = v_twin_company_id
            LOOP
                v_new_id := gen_random_uuid();
                v_node_map := v_node_map || jsonb_build_object(v_node_rec.id::TEXT, v_new_id::TEXT);

                INSERT INTO twin.dim_node (
                    id, company_id, dim_type_id, label, summary, tags,
                    visibility, sensitive,
                    business_application_id, business_process_id, integration_id,
                    embedding, valid_from, valid_to, updated_at
                ) VALUES (
                    v_new_id, v_new_company_uuid, v_node_rec.dim_type_id,
                    v_node_rec.label, v_node_rec.summary, v_node_rec.tags,
                    v_node_rec.visibility, v_node_rec.sensitive,
                    v_node_rec.business_application_id, v_node_rec.business_process_id,
                    v_node_rec.integration_id, v_node_rec.embedding,
                    v_node_rec.valid_from, v_node_rec.valid_to, NOW()
                );
                v_total := v_total + 1;
            END LOOP;
            SELECT COUNT(*) INTO v_rows FROM twin.dim_node WHERE company_id = v_twin_company_id;
            RAISE NOTICE '  %-44s : % row(s)', 'twin.dim_node', v_rows;

            -- Copy dim_edges (remap source_id + target_id)
            INSERT INTO twin.dim_edge (id, source_id, target_id, rel_type, weight, meta, valid_from, valid_to)
            SELECT
                gen_random_uuid(),
                (v_node_map ->> e.source_id::TEXT)::UUID,
                (v_node_map ->> e.target_id::TEXT)::UUID,
                e.rel_type, e.weight, e.meta, e.valid_from, e.valid_to
            FROM twin.dim_edge e
            INNER JOIN twin.dim_node n ON n.id = e.source_id
            WHERE n.company_id = v_twin_company_id
              AND (v_node_map ->> e.source_id::TEXT) IS NOT NULL
              AND (v_node_map ->> e.target_id::TEXT) IS NOT NULL
            ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            RAISE NOTICE '  %-44s : % row(s)', 'twin.dim_edge', v_rows;
            v_total := v_total + v_rows;

            -- Copy source_refs (remap dim_node_id)
            INSERT INTO twin.source_ref (id, dim_node_id, system_name, external_id, mcp_tool, last_synced, created_at)
            SELECT
                gen_random_uuid(),
                (v_node_map ->> sr.dim_node_id::TEXT)::UUID,
                sr.system_name, sr.external_id, sr.mcp_tool, sr.last_synced, NOW()
            FROM twin.source_ref sr
            INNER JOIN twin.dim_node n ON n.id = sr.dim_node_id
            WHERE n.company_id = v_twin_company_id
              AND (v_node_map ->> sr.dim_node_id::TEXT) IS NOT NULL
            ON CONFLICT (dim_node_id, system_name, external_id) DO NOTHING;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            RAISE NOTICE '  %-44s : % row(s)', 'twin.source_ref', v_rows;
            v_total := v_total + v_rows;

            -- Copy dim_node_attachments (remap node_id)
            INSERT INTO twin.dim_node_attachment (id, node_id, filename, content_type, size_bytes, data, uploaded_at)
            SELECT
                gen_random_uuid(),
                (v_node_map ->> da.node_id::TEXT)::UUID,
                da.filename, da.content_type, da.size_bytes, da.data, NOW()
            FROM twin.dim_node_attachment da
            INNER JOIN twin.dim_node n ON n.id = da.node_id
            WHERE n.company_id = v_twin_company_id
              AND (v_node_map ->> da.node_id::TEXT) IS NOT NULL;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            RAISE NOTICE '  %-44s : % row(s)', 'twin.dim_node_attachment', v_rows;
            v_total := v_total + v_rows;

            -- Copy context_log (remap company_id to new UUID)
            INSERT INTO twin.context_log (id, company_id, caller_type, caller_id, chunk_ids, tokens_used, llm_target, created_at)
            SELECT gen_random_uuid(), v_new_company_uuid, caller_type, caller_id, chunk_ids, tokens_used, llm_target, created_at
            FROM twin.context_log
            WHERE company_id = v_twin_company_id
            ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            RAISE NOTICE '  %-44s : % row(s)', 'twin.context_log', v_rows;
            v_total := v_total + v_rows;

        END IF;

    END IF;

    -- ──────────────────────────────────────────────────────────
    -- Public schema
    -- ──────────────────────────────────────────────────────────
    RAISE NOTICE '';
    RAISE NOTICE '  [ public ]';

    IF v_mode = 'MOVE' THEN
        RAISE NOTICE '  %-44s : no-op (no tenant_id column; agent_id unchanged)', 'public.agent_attachment';
    ELSE -- COPY
        INSERT INTO public.agent_attachment (id, agent_id, filename, mime_type, file_size_bytes, file_data, created_at, updated_at)
        SELECT gen_random_uuid(), aa.agent_id, aa.filename, aa.mime_type, aa.file_size_bytes, aa.file_data, NOW(), NOW()
        FROM public.agent_attachment aa
        INNER JOIN core.agents ag
            ON ag.agent_id = aa.agent_id
           AND ag.company_id = v_source_company_id
           AND ag.tenant_id  = v_source_tenant
           AND COALESCE(ag.is_current, true) = true
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RAISE NOTICE '  %-44s : % row(s)', 'public.agent_attachment', v_rows;
        v_total := v_total + v_rows;
    END IF;

    -- ============================================================
    -- Done
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================================';
    RAISE NOTICE '% complete. % total row(s) affected.', v_mode, v_total;
    IF v_mode = 'COPY' THEN
        RAISE NOTICE 'Source records in tenant % are unchanged.', v_source_tenant;
        RAISE NOTICE 'Rows with conflicting unique keys were silently skipped.';
    END IF;
    RAISE NOTICE '========================================================';

END $$;
