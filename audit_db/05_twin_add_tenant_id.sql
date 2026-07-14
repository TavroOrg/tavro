-- =============================================================
-- RUN THIS DIRECTLY AGAINST THE HOSTED PRODUCTION DATABASE
-- Combines what were three sequential scripts (tenant_id addition,
-- composite key promotion, then widening to include company_id) into
-- one file, run top to bottom. twin.dim_type is deliberately excluded
-- throughout — it's a shared system catalog (system_defined=true rows
-- are meant to be global across all tenants); any tenant-created
-- "custom" dim_types can't be backfilled from existing data alone, so it
-- just gets a nullable tenant_id column with no CHECK, no PK involvement.
--
-- END STATE for every other twin table — the same (tenant_id,
-- company_id, asset_id) shape core schema uses for its direct-owner
-- tables, "id" playing the asset_id role:
--   twin.company             -> PRIMARY KEY (tenant_id, id). No separate
--                                company_id of its own (it IS the
--                                company), so this is already its final
--                                shape — plus a standalone UNIQUE(id),
--                                since every existing FK (OSS and
--                                enterprise) points at company(id) alone.
--   twin.dim_node             -> PRIMARY KEY (tenant_id, company_id, id),
--                                plus a standalone UNIQUE(id) for the
--                                same reason (dim_edge/source_ref/
--                                dim_node_attachment/compliance_impact
--                                all FK to dim_node(id) alone).
--   twin.dim_edge             -> company_id newly added (backfilled from
--                                dim_node), PRIMARY KEY (tenant_id,
--                                company_id, id).
--   twin.source_ref           -> same treatment as dim_edge.
--   twin.dim_node_attachment  -> same treatment as dim_edge.
--   twin.context_log          -> already had company_id; PRIMARY KEY
--                                (tenant_id, company_id, id, created_at)
--                                — created_at stays, it's the partition
--                                key.
-- Every child table above also gets a composite FK to its parent's new
-- key (added alongside any pre-existing single-column FK, never
-- dropping it), so an edge/attachment/source_ref referencing a dim_node
-- from a DIFFERENT company than it claims is rejected — an integrity
-- guarantee none of these had before this script.
--
-- NOT auto-applied anywhere: unlike sql/core/*.sql (run on every
-- tavro-api startup via init_tables.py) or sql/tavro_setup_all.sql (only
-- runs via docker-entrypoint-initdb.d on a truly empty Postgres volume),
-- there is no automatic mechanism that retroactively changes an
-- already-existing twin table. This script is that one-time step.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   - ADD COLUMN (nullable) is metadata-only, no table rewrite.
--   - Backfill UPDATEs only touch rows with a currently-NULL target
--     column — safe to re-run, cheap on a second run since nothing
--     matches. No cross-tenant ambiguity anywhere in this file (unlike
--     audit_db/06_attachment_move_to_core.sql): every backfill here
--     joins through a column that is already NOT NULL and FK-enforced,
--     so exactly one source row is always available.
--   - NOT NULL / PRIMARY KEY / composite FK promotions follow the same
--     NOT VALID -> VALIDATE -> SET NOT NULL pattern used throughout
--     audit_db/03_critical_tenant_and_composite_pk.sql. Each step is
--     independently guarded (BEGIN/EXCEPTION), so one table's issue
--     doesn't abort the rest — it logs a NOTICE and is skipped, safe to
--     re-run after fixing the underlying data.
--   - Replacing a table's PK when OTHER tables still hold a live FK to
--     it requires CASCADE, which only drops the dependent CONSTRAINT
--     OBJECTS — never data. Every constraint CASCADE removes here is
--     explicitly recreated later in this same file, same name and
--     definition (or widened, where that's the point of the step) —
--     nothing is permanently lost. This affects company_pkey (6
--     dependent FKs: dim_node plus 5 enterprise tables — audit_finding,
--     audit_run, compliance_impact, compliance_item, datahub_context)
--     and dim_node_pkey (4 dependent FKs: dim_edge x2, source_ref,
--     compliance_impact — compliance_impact's ON DELETE SET NULL is
--     preserved exactly, the rest keep ON DELETE CASCADE).
--   - PRODUCTION NOTE — large tables: CREATE UNIQUE INDEX/PRIMARY KEY
--     CONCURRENTLY cannot run inside a DO block. If dim_edge/source_ref/
--     dim_node_attachment hold significant volume in your environment,
--     build the backing index out-of-band first, as its own statement,
--     outside any transaction, under the exact constraint name this
--     script checks for — its "already exists" guard will pick it up
--     and skip cleanly.
--   - Idempotent end to end: every step is guarded via pg_constraint /
--     information_schema, including definition-based checks where a
--     same-named constraint could otherwise already exist in a
--     narrower, pre-widened shape from an earlier partial run.
--
-- AFTER RUNNING — validate the NOT VALID FKs once confirmed clean:
--   ALTER TABLE twin.<table> VALIDATE CONSTRAINT <constraint_name>;
-- =============================================================

-- ------------------------------------------------------------
-- Step 1: add tenant_id (nullable) to every table missing it
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_type' AND column_name='tenant_id') THEN
        ALTER TABLE twin.dim_type ADD COLUMN tenant_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_node' AND column_name='tenant_id') THEN
        ALTER TABLE twin.dim_node ADD COLUMN tenant_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_edge' AND column_name='tenant_id') THEN
        ALTER TABLE twin.dim_edge ADD COLUMN tenant_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='source_ref' AND column_name='tenant_id') THEN
        ALTER TABLE twin.source_ref ADD COLUMN tenant_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_node_attachment' AND column_name='tenant_id') THEN
        ALTER TABLE twin.dim_node_attachment ADD COLUMN tenant_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='context_log' AND column_name='tenant_id') THEN
        ALTER TABLE twin.context_log ADD COLUMN tenant_id TEXT;
    END IF;
END $$;

-- ------------------------------------------------------------
-- Step 2: backfill tenant_id from existing relationships
-- ------------------------------------------------------------

-- dim_node <- company
UPDATE twin.dim_node n
SET tenant_id = c.tenant_id
FROM twin.company c
WHERE n.company_id = c.id
  AND n.tenant_id IS NULL;

-- dim_edge <- dim_node (via source_id; source and target are always the
-- same tenant since an edge never crosses company boundaries)
UPDATE twin.dim_edge e
SET tenant_id = n.tenant_id
FROM twin.dim_node n
WHERE e.source_id = n.id
  AND e.tenant_id IS NULL;

-- source_ref <- dim_node
UPDATE twin.source_ref s
SET tenant_id = n.tenant_id
FROM twin.dim_node n
WHERE s.dim_node_id = n.id
  AND s.tenant_id IS NULL;

-- dim_node_attachment <- dim_node
UPDATE twin.dim_node_attachment a
SET tenant_id = n.tenant_id
FROM twin.dim_node n
WHERE a.node_id = n.id
  AND a.tenant_id IS NULL;

-- context_log <- company (bare UUID column, no FK yet at this point in
-- the script, but same values as twin.company.id in practice)
UPDATE twin.context_log l
SET tenant_id = c.tenant_id
FROM twin.company c
WHERE l.company_id = c.id
  AND l.tenant_id IS NULL;

-- ------------------------------------------------------------
-- Step 3: NOT VALID CHECK -> VALIDATE -> SET NOT NULL for tenant_id, per
-- table. dim_type is deliberately excluded — stays nullable permanently.
-- ------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT unnest(ARRAY['dim_node','dim_edge','source_ref','dim_node_attachment','context_log']) AS table_name
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = 'twin' AND c.conname = 'chk_' || r.table_name || '_tenant_id_present'
            ) THEN
                EXECUTE format(
                    'ALTER TABLE twin.%I ADD CONSTRAINT %I CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '''') NOT VALID',
                    r.table_name, 'chk_' || r.table_name || '_tenant_id_present'
                );
                RAISE NOTICE 'twin.%: added NOT VALID tenant_id CHECK', r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'twin.%: tenant_id CHECK skipped — %', r.table_name, SQLERRM;
        END;

        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'twin' AND table_name = r.table_name
                  AND column_name = 'tenant_id' AND is_nullable = 'YES'
            ) THEN
                EXECUTE format('ALTER TABLE twin.%I VALIDATE CONSTRAINT %I', r.table_name, 'chk_' || r.table_name || '_tenant_id_present');
                EXECUTE format('ALTER TABLE twin.%I ALTER COLUMN tenant_id SET NOT NULL', r.table_name);
                RAISE NOTICE 'twin.%: tenant_id set NOT NULL', r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'twin.%: tenant_id NOT NULL promotion skipped (likely existing NULL rows — check the backfill joins above) — %', r.table_name, SQLERRM;
        END;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- Step 4: promote company/dim_node to a real composite PRIMARY KEY,
-- alongside a standalone UNIQUE(id) so every pre-existing single-column
-- FK (OSS and enterprise) keeps resolving. Also promotes
-- dim_edge/source_ref/dim_node_attachment/context_log to a composite PK
-- by direct replacement (nothing FKs to any of these four by id).
-- ------------------------------------------------------------
DO $$
BEGIN
    -- twin.company: tenant_id NOT NULL promotion + composite PK
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_company_tenant_id_present'
        ) THEN
            ALTER TABLE twin.company ADD CONSTRAINT chk_company_tenant_id_present
                CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> '') NOT VALID;
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'twin' AND table_name = 'company' AND column_name = 'tenant_id' AND is_nullable = 'YES'
        ) THEN
            ALTER TABLE twin.company VALIDATE CONSTRAINT chk_company_tenant_id_present;
            ALTER TABLE twin.company ALTER COLUMN tenant_id SET NOT NULL;
            RAISE NOTICE 'twin.company: tenant_id set NOT NULL';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.company: tenant_id NOT NULL promotion skipped (likely existing NULL rows) — %', SQLERRM;
    END;

    -- company_pkey is dropped and replaced by a real composite PK. A
    -- standalone UNIQUE(id) is added first — every existing FK (OSS and
    -- enterprise) points at company(id) alone and still needs that to
    -- resolve. company_pkey is also depended on by 6 single-column FKs —
    -- twin.dim_node plus 5 enterprise tables (audit_finding, audit_run,
    -- compliance_impact, compliance_item, datahub_context), all
    -- identically shaped: FOREIGN KEY (company_id) REFERENCES
    -- twin.company(id) ON DELETE CASCADE. CASCADE drops all 6; each is
    -- explicitly recreated below, same name and definition, now bound to
    -- ux_company_id instead of the dropped PK — a pure re-bind, not a
    -- redesign.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_company') THEN
            ALTER TABLE twin.company DROP CONSTRAINT IF EXISTS ux_company_tenant_id CASCADE;
            ALTER TABLE twin.company ADD CONSTRAINT ux_company_id UNIQUE (id);
            ALTER TABLE twin.company DROP CONSTRAINT company_pkey CASCADE;
            ALTER TABLE twin.company ADD CONSTRAINT pk_company PRIMARY KEY (tenant_id, id);

            ALTER TABLE twin.dim_node ADD CONSTRAINT dim_node_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;
            ALTER TABLE twin.audit_finding ADD CONSTRAINT audit_finding_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;
            ALTER TABLE twin.audit_run ADD CONSTRAINT audit_run_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;
            ALTER TABLE twin.compliance_impact ADD CONSTRAINT compliance_impact_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;
            ALTER TABLE twin.compliance_item ADD CONSTRAINT compliance_item_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;
            ALTER TABLE twin.datahub_context ADD CONSTRAINT datahub_context_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES twin.company (id) ON DELETE CASCADE;

            RAISE NOTICE 'twin.company: composite PK added (ux_company_id kept for existing single-column FKs; all 6 dependent FKs recreated identically)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.company: composite PK skipped — %', SQLERRM;
    END;

    -- twin.dim_node: same treatment as company, for the same reason —
    -- dim_edge/source_ref/dim_node_attachment/compliance_impact all FK to
    -- dim_node(id) alone. dim_node_pkey's 4 dependents: dim_edge (source
    -- + target), source_ref, and enterprise compliance_impact —
    -- compliance_impact's ON DELETE SET NULL is preserved exactly, the
    -- other three's ON DELETE CASCADE is preserved exactly.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_node') THEN
            ALTER TABLE twin.dim_node DROP CONSTRAINT IF EXISTS ux_dim_node_tenant_id CASCADE;
            ALTER TABLE twin.dim_node ADD CONSTRAINT ux_dim_node_id UNIQUE (id);
            ALTER TABLE twin.dim_node DROP CONSTRAINT dim_node_pkey CASCADE;
            ALTER TABLE twin.dim_node ADD CONSTRAINT pk_dim_node PRIMARY KEY (tenant_id, id);

            ALTER TABLE twin.dim_edge ADD CONSTRAINT dim_edge_source_id_fkey
                FOREIGN KEY (source_id) REFERENCES twin.dim_node (id) ON DELETE CASCADE;
            ALTER TABLE twin.dim_edge ADD CONSTRAINT dim_edge_target_id_fkey
                FOREIGN KEY (target_id) REFERENCES twin.dim_node (id) ON DELETE CASCADE;
            ALTER TABLE twin.source_ref ADD CONSTRAINT source_ref_dim_node_id_fkey
                FOREIGN KEY (dim_node_id) REFERENCES twin.dim_node (id) ON DELETE CASCADE;
            ALTER TABLE twin.compliance_impact ADD CONSTRAINT compliance_impact_dim_node_id_fkey
                FOREIGN KEY (dim_node_id) REFERENCES twin.dim_node (id) ON DELETE SET NULL;

            RAISE NOTICE 'twin.dim_node: composite PK added (ux_dim_node_id kept for existing single-column FKs; all 4 dependent FKs recreated identically)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node: composite PK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_node_company_tenant') THEN
            ALTER TABLE twin.dim_node ADD CONSTRAINT fk_dim_node_company_tenant
                FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'twin.dim_node: composite FK to company added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node: composite FK to company skipped — %', SQLERRM;
    END;

    -- twin.dim_edge: PK replaced + composite FKs to dim_node (alongside)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_edge') THEN
            ALTER TABLE twin.dim_edge DROP CONSTRAINT IF EXISTS dim_edge_pkey;
            ALTER TABLE twin.dim_edge ADD CONSTRAINT pk_dim_edge PRIMARY KEY (tenant_id, id);
            RAISE NOTICE 'twin.dim_edge: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: composite PK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_edge_source_tenant') THEN
            ALTER TABLE twin.dim_edge ADD CONSTRAINT fk_dim_edge_source_tenant
                FOREIGN KEY (tenant_id, source_id) REFERENCES twin.dim_node (tenant_id, id) ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'twin.dim_edge: composite FK (source) to dim_node added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: composite FK (source) skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_edge_target_tenant') THEN
            ALTER TABLE twin.dim_edge ADD CONSTRAINT fk_dim_edge_target_tenant
                FOREIGN KEY (tenant_id, target_id) REFERENCES twin.dim_node (tenant_id, id) ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'twin.dim_edge: composite FK (target) to dim_node added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: composite FK (target) skipped — %', SQLERRM;
    END;

    -- twin.source_ref: PK replaced + composite FK to dim_node (alongside)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_source_ref') THEN
            ALTER TABLE twin.source_ref DROP CONSTRAINT IF EXISTS source_ref_pkey;
            ALTER TABLE twin.source_ref ADD CONSTRAINT pk_source_ref PRIMARY KEY (tenant_id, id);
            RAISE NOTICE 'twin.source_ref: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.source_ref: composite PK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_ref_dim_node_tenant') THEN
            ALTER TABLE twin.source_ref ADD CONSTRAINT fk_source_ref_dim_node_tenant
                FOREIGN KEY (tenant_id, dim_node_id) REFERENCES twin.dim_node (tenant_id, id) ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'twin.source_ref: composite FK to dim_node added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.source_ref: composite FK skipped — %', SQLERRM;
    END;

    -- twin.dim_node_attachment: PK replaced + composite FK to dim_node (alongside)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_node_attachment') THEN
            ALTER TABLE twin.dim_node_attachment DROP CONSTRAINT IF EXISTS dim_node_attachment_pkey;
            ALTER TABLE twin.dim_node_attachment ADD CONSTRAINT pk_dim_node_attachment PRIMARY KEY (tenant_id, id);
            RAISE NOTICE 'twin.dim_node_attachment: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node_attachment: composite PK skipped — %', SQLERRM;
    END;

    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_node_attachment_node_tenant') THEN
            ALTER TABLE twin.dim_node_attachment ADD CONSTRAINT fk_dim_node_attachment_node_tenant
                FOREIGN KEY (tenant_id, node_id) REFERENCES twin.dim_node (tenant_id, id) ON DELETE CASCADE NOT VALID;
            RAISE NOTICE 'twin.dim_node_attachment: composite FK to dim_node added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node_attachment: composite FK skipped — %', SQLERRM;
    END;

    -- twin.context_log: PK replaced (partition key created_at stays) +
    -- new composite FK to company (company_id had no FK at all before this)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'context_log_pkey' AND pg_get_constraintdef(oid) LIKE '%tenant_id%') THEN
            ALTER TABLE twin.context_log DROP CONSTRAINT IF EXISTS context_log_pkey;
            ALTER TABLE twin.context_log ADD PRIMARY KEY (tenant_id, id, created_at);
            RAISE NOTICE 'twin.context_log: composite PK added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.context_log: composite PK skipped — %', SQLERRM;
    END;

    -- NOT VALID is unsupported for a FK added directly to a partitioned
    -- table (Postgres restriction — it validates immediately regardless).
    -- Fine here: context_log is an append-only log, typically near-empty
    -- relative to its retention window.
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_context_log_company_tenant') THEN
            ALTER TABLE twin.context_log ADD CONSTRAINT fk_context_log_company_tenant
                FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE;
            RAISE NOTICE 'twin.context_log: composite FK to company added';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.context_log: composite FK skipped — %', SQLERRM;
    END;
END $$;

-- ------------------------------------------------------------
-- Step 5: widen dim_edge/source_ref/dim_node_attachment to carry their
-- own company_id (backfilled from dim_node — no ambiguity possible,
-- dim_node.company_id is already NOT NULL and FK-enforced).
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_edge' AND column_name='company_id') THEN
        ALTER TABLE twin.dim_edge ADD COLUMN company_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='source_ref' AND column_name='company_id') THEN
        ALTER TABLE twin.source_ref ADD COLUMN company_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='twin' AND table_name='dim_node_attachment' AND column_name='company_id') THEN
        ALTER TABLE twin.dim_node_attachment ADD COLUMN company_id UUID;
    END IF;
END $$;

UPDATE twin.dim_edge e SET company_id = n.company_id
FROM twin.dim_node n WHERE e.source_id = n.id AND e.company_id IS NULL;

UPDATE twin.source_ref s SET company_id = n.company_id
FROM twin.dim_node n WHERE s.dim_node_id = n.id AND s.company_id IS NULL;

UPDATE twin.dim_node_attachment a SET company_id = n.company_id
FROM twin.dim_node n WHERE a.node_id = n.id AND a.company_id IS NULL;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT unnest(ARRAY['dim_edge','source_ref','dim_node_attachment']) AS table_name
    LOOP
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE n.nspname = 'twin' AND c.conname = 'chk_' || r.table_name || '_company_id_present'
            ) THEN
                EXECUTE format('ALTER TABLE twin.%I ADD CONSTRAINT %I CHECK (company_id IS NOT NULL) NOT VALID',
                    r.table_name, 'chk_' || r.table_name || '_company_id_present');
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'twin' AND table_name = r.table_name AND column_name = 'company_id' AND is_nullable = 'YES'
            ) THEN
                EXECUTE format('ALTER TABLE twin.%I VALIDATE CONSTRAINT %I', r.table_name, 'chk_' || r.table_name || '_company_id_present');
                EXECUTE format('ALTER TABLE twin.%I ALTER COLUMN company_id SET NOT NULL', r.table_name);
                RAISE NOTICE 'twin.%: company_id set NOT NULL', r.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'twin.%: company_id NOT NULL promotion skipped — %', r.table_name, SQLERRM;
        END;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- Step 6: widen dim_node's PK to (tenant_id, company_id, id) — cascades
-- to drop 4 dependent FKs, each recreated below in its widened form.
-- Then add the new company FKs, recreate the 4 widened FKs, widen
-- dim_edge/source_ref/dim_node_attachment's own PKs (direct replacement
-- — nothing FKs to any of them by id or by their existing key), and
-- widen context_log's PK (partitioned; Postgres applies this to every
-- existing partition automatically).
-- ------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_node'
              AND pg_get_constraintdef(oid) LIKE '%company_id%'
        ) THEN
            ALTER TABLE twin.dim_node DROP CONSTRAINT IF EXISTS pk_dim_node CASCADE;
            ALTER TABLE twin.dim_node ADD CONSTRAINT pk_dim_node PRIMARY KEY (tenant_id, company_id, id);
            RAISE NOTICE 'twin.dim_node: PK widened to (tenant_id, company_id, id)';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node: PK widen skipped — %', SQLERRM;
    END;

    -- New company FKs (none of these tables had one before this step)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_edge_company_tenant') THEN
            ALTER TABLE twin.dim_edge ADD CONSTRAINT fk_dim_edge_company_tenant
                FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: company FK skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_ref_company_tenant') THEN
            ALTER TABLE twin.source_ref ADD CONSTRAINT fk_source_ref_company_tenant
                FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.source_ref: company FK skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_node_attachment_company_tenant') THEN
            ALTER TABLE twin.dim_node_attachment ADD CONSTRAINT fk_dim_node_attachment_company_tenant
                FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node_attachment: company FK skipped — %', SQLERRM;
    END;

    -- Recreate the 4 FKs cascade-dropped above, widened to include company_id
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_edge_source_tenant') THEN
            ALTER TABLE twin.dim_edge ADD CONSTRAINT fk_dim_edge_source_tenant
                FOREIGN KEY (tenant_id, company_id, source_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: source FK skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_edge_target_tenant') THEN
            ALTER TABLE twin.dim_edge ADD CONSTRAINT fk_dim_edge_target_tenant
                FOREIGN KEY (tenant_id, company_id, target_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: target FK skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_ref_dim_node_tenant') THEN
            ALTER TABLE twin.source_ref ADD CONSTRAINT fk_source_ref_dim_node_tenant
                FOREIGN KEY (tenant_id, company_id, dim_node_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.source_ref: dim_node FK skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dim_node_attachment_node_tenant') THEN
            ALTER TABLE twin.dim_node_attachment ADD CONSTRAINT fk_dim_node_attachment_node_tenant
                FOREIGN KEY (tenant_id, company_id, node_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node_attachment: node FK skipped — %', SQLERRM;
    END;

    -- Widen dim_edge/source_ref/dim_node_attachment's own PKs
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_edge' AND pg_get_constraintdef(oid) LIKE '%company_id%'
        ) THEN
            ALTER TABLE twin.dim_edge DROP CONSTRAINT pk_dim_edge;
            ALTER TABLE twin.dim_edge ADD CONSTRAINT pk_dim_edge PRIMARY KEY (tenant_id, company_id, id);
            RAISE NOTICE 'twin.dim_edge: PK widened';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_edge: PK widen skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'pk_source_ref' AND pg_get_constraintdef(oid) LIKE '%company_id%'
        ) THEN
            ALTER TABLE twin.source_ref DROP CONSTRAINT pk_source_ref;
            ALTER TABLE twin.source_ref ADD CONSTRAINT pk_source_ref PRIMARY KEY (tenant_id, company_id, id);
            RAISE NOTICE 'twin.source_ref: PK widened';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.source_ref: PK widen skipped — %', SQLERRM;
    END;
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'pk_dim_node_attachment' AND pg_get_constraintdef(oid) LIKE '%company_id%'
        ) THEN
            ALTER TABLE twin.dim_node_attachment DROP CONSTRAINT pk_dim_node_attachment;
            ALTER TABLE twin.dim_node_attachment ADD CONSTRAINT pk_dim_node_attachment PRIMARY KEY (tenant_id, company_id, id);
            RAISE NOTICE 'twin.dim_node_attachment: PK widened';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.dim_node_attachment: PK widen skipped — %', SQLERRM;
    END;

    -- Widen context_log's PK
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'context_log_pkey' AND pg_get_constraintdef(oid) LIKE '%company_id%'
        ) THEN
            ALTER TABLE twin.context_log DROP CONSTRAINT context_log_pkey;
            ALTER TABLE twin.context_log ADD PRIMARY KEY (tenant_id, company_id, id, created_at);
            RAISE NOTICE 'twin.context_log: PK widened';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'twin.context_log: PK widen skipped — %', SQLERRM;
    END;
END $$;
