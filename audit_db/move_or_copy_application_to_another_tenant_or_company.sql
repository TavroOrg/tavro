DO $$
DECLARE
    -- ============================================================
    -- SET YOUR VALUES HERE
    -- ============================================================
    v_source_company_id TEXT := 'SOURCE_COMPANY_ID';
    v_source_tenant     TEXT := 'SOURCE_TENANT_ID';
    v_target_company_id TEXT := 'TARGET_COMPANY_ID';
    v_target_tenant     TEXT := 'TARGET_TENANT_ID';
    v_mode              TEXT := 'MOVE';              -- 'MOVE' or 'COPY'
    -- ============================================================

    v_source_twin_company_id UUID;
    v_target_twin_company_id UUID;
    v_app_dim_type_id        UUID;
    v_rows                   INT;
    v_count                  INT;
    v_cols_select            TEXT;
    v_cols_insert            TEXT;

BEGIN

    IF v_mode NOT IN ('MOVE', 'COPY') THEN
        RAISE EXCEPTION 'v_mode must be MOVE or COPY. Got: %', v_mode;
    END IF;

    v_source_twin_company_id := v_source_company_id::UUID;
    v_target_twin_company_id := v_target_company_id::UUID;

    SELECT id INTO v_app_dim_type_id FROM twin.dim_type WHERE name = 'Application';
    IF v_app_dim_type_id IS NULL THEN
        RAISE EXCEPTION 'twin.dim_type "Application" not found. Ensure seed data is loaded.';
    END IF;

    RAISE NOTICE '========================================================';
    RAISE NOTICE 'MODE                    : %', v_mode;
    RAISE NOTICE 'Source company / tenant : % / %', v_source_company_id, v_source_tenant;
    RAISE NOTICE 'Target company / tenant : % / %', v_target_company_id, v_target_tenant;
    RAISE NOTICE '========================================================';

    -- ============================================================
    -- STEP 1 — Verify source data exists
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 1: Verify source data ---';

    SELECT COUNT(*) INTO v_count FROM core.business_applications
    WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'No business_applications found for company % in tenant %. Aborting.',
            v_source_company_id, v_source_tenant;
    END IF;
    RAISE NOTICE '[OK] % application(s) found in source.', v_count;

    SELECT COUNT(*) INTO v_count FROM twin.company WHERE id = v_target_twin_company_id;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Target twin.company % does not exist. Create it first and re-run.', v_target_twin_company_id;
    END IF;
    RAISE NOTICE '[OK] Target twin.company found.';

    -- ============================================================
    -- STEP 2 — Record counts
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 2: Record counts in source ---';
    RAISE NOTICE '';

    SELECT COUNT(*) INTO v_count FROM core.business_applications
    WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant;
    RAISE NOTICE '  %-44s : %', 'core.business_applications', v_count;

    SELECT COUNT(*) INTO v_count FROM twin.dim_node
    WHERE company_id  = v_source_twin_company_id
      AND dim_type_id = v_app_dim_type_id
      AND valid_to    IS NULL;
    RAISE NOTICE '  %-44s : %', 'twin.dim_node (Application, active)', v_count;

    -- ============================================================
    -- STEP 3 — Conflict checks
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '--- Step 3: Conflict checks ---';

    SELECT COUNT(*) INTO v_count
    FROM core.business_applications s
    INNER JOIN core.business_applications t
        ON t.business_application_id = s.business_application_id
       AND t.company_id = v_target_company_id
       AND t.tenant_id  = v_target_tenant
    WHERE s.company_id = v_source_company_id AND s.tenant_id = v_source_tenant;

    IF v_count > 0 THEN
        IF v_mode = 'MOVE' THEN
            RAISE EXCEPTION 'ABORTED — % collision(s) in core.business_applications for target company/tenant.', v_count;
        ELSE
            RAISE NOTICE '  [WARNING] % application(s) already in target — overlapping rows will be skipped.', v_count;
        END IF;
    ELSE
        RAISE NOTICE '  [OK] core.business_applications — no conflicts.';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM twin.dim_node src
    INNER JOIN twin.dim_node tgt
        ON tgt.business_application_id = src.business_application_id
       AND tgt.company_id = v_target_twin_company_id
       AND tgt.valid_to   IS NULL
    WHERE src.company_id  = v_source_twin_company_id
      AND src.dim_type_id = v_app_dim_type_id
      AND src.valid_to    IS NULL;

    IF v_count > 0 THEN
        IF v_mode = 'MOVE' THEN
            RAISE EXCEPTION 'ABORTED — % dim_node collision(s) in target twin company.', v_count;
        ELSE
            RAISE NOTICE '  [WARNING] % dim_node(s) already in target twin company — overlapping rows will be skipped.', v_count;
        END IF;
    ELSE
        RAISE NOTICE '  [OK] twin.dim_node — no conflicts.';
    END IF;

    -- ============================================================
    -- STEP 4 — Execute: core.business_applications
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================================';
    RAISE NOTICE '% starting...', v_mode;
    RAISE NOTICE '========================================================';

    IF v_mode = 'MOVE' THEN

        UPDATE core.business_applications
        SET company_id = v_target_company_id,
            tenant_id  = v_target_tenant
        WHERE company_id = v_source_company_id AND tenant_id = v_source_tenant;

    ELSE -- COPY

        SELECT
            string_agg(
                CASE
                    WHEN column_name = 'tenant_id'  THEN quote_literal(v_target_tenant)
                    WHEN column_name = 'company_id' THEN quote_literal(v_target_company_id)
                    ELSE quote_ident(column_name)
                END, ', ' ORDER BY ordinal_position
            ),
            string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
        INTO v_cols_select, v_cols_insert
        FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'business_applications';

        EXECUTE format(
            'INSERT INTO core.business_applications (%s) SELECT %s FROM core.business_applications WHERE company_id = %L AND tenant_id = %L ON CONFLICT DO NOTHING',
            v_cols_insert, v_cols_select, v_source_company_id, v_source_tenant
        );

    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  %-44s : % row(s)', 'core.business_applications', v_rows;

    -- ============================================================
    -- STEP 5 — Execute: twin.dim_node
    -- ============================================================
    IF v_mode = 'MOVE' THEN

        UPDATE twin.dim_node
        SET company_id = v_target_twin_company_id,
            updated_at = NOW()
        WHERE company_id  = v_source_twin_company_id
          AND dim_type_id = v_app_dim_type_id
          AND valid_to    IS NULL
          AND business_application_id IN (
              SELECT business_application_id FROM core.business_applications
              WHERE company_id = v_target_company_id
                AND tenant_id  = v_target_tenant
          );

    ELSE -- COPY

        -- LEFT JOIN ensures ALL applications get a dim_node, even those with no source node.
        -- Label uses source node label → application_name → business_application_id as fallback.
        INSERT INTO twin.dim_node (
            id, company_id, dim_type_id, label, summary,
            tags, visibility, sensitive,
            business_application_id,
            valid_from, updated_at
        )
        SELECT
            gen_random_uuid(),
            v_target_twin_company_id,
            v_app_dim_type_id,
            COALESCE(src.label, ba.application_name, ba.business_application_id),
            COALESCE(src.summary, ba.application_description),
            COALESCE(src.tags, ba.tags, '[]'),
            COALESCE(src.visibility, ba.visibility, 'internal'),
            COALESCE(src.sensitive, ba.sensitive, false),
            ba.business_application_id,
            NOW(),
            NOW()
        FROM core.business_applications ba
        LEFT JOIN twin.dim_node src
            ON src.business_application_id = ba.business_application_id
           AND src.company_id  = v_source_twin_company_id
           AND src.dim_type_id = v_app_dim_type_id
           AND src.valid_to    IS NULL
        WHERE ba.company_id = v_source_company_id
          AND ba.tenant_id  = v_source_tenant
          AND NOT EXISTS (
              SELECT 1 FROM twin.dim_node
              WHERE business_application_id = ba.business_application_id
                AND company_id = v_target_twin_company_id
                AND valid_to IS NULL
          )
        ON CONFLICT DO NOTHING;

    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE '  %-44s : % row(s)', 'twin.dim_node (Application)', v_rows;

    -- ============================================================
    -- Done
    -- ============================================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================================';
    RAISE NOTICE '% complete.', v_mode;
    IF v_mode = 'COPY' THEN
        RAISE NOTICE 'Source records (company %, tenant %) are unchanged.', v_source_company_id, v_source_tenant;
    END IF;
    RAISE NOTICE '========================================================';

END $$;
