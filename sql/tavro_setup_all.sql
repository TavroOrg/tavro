-- =============================================================
-- Tavro Portal — Master Database Setup Script (OSS core schema)
-- Version: 2025-05
-- Run order: extensions → core schema → seed data
--
-- This file is OSS-only — it never defines compliance/audit tables.
-- Enterprise builds (BUILD_MODE=enterprise) additionally load
-- enterprise/sql/zz_enterprise_compliance_audit.sql, baked into the image
-- by Dockerfile.postgres.enterprise, which runs after this file (its "zz_"
-- filename prefix sorts after "tavro_setup_all.sql").
--
-- Usage (from host):
--   docker compose exec tavro-postgres \
--     psql -U tavro -d tavro -f /sql/tavro_setup_all.sql
--
-- Or copy into container first:
--   docker cp sql/tavro_setup_all.sql tavro-postgres:/tmp/tavro_setup_all.sql
--   docker compose exec tavro-postgres \
--     psql -U tavro -d tavro -f /tmp/tavro_setup_all.sql
-- =============================================================

\echo '======================================================'
\echo ' Tavro Portal — Database Setup'
\echo '======================================================'

-- ── 0. Extensions ─────────────────────────────────────────────────────────────
\echo '[1/3] Loading extensions...'

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;
ALTER DATABASE tavro SET search_path = ag_catalog, "$user", public;


-- ── 1. Schema & core types ────────────────────────────────────────────────────
\echo '[2/3] Creating core schema...'

CREATE SCHEMA IF NOT EXISTS twin;
SET search_path = twin, ag_catalog, public;

-- Enums (CREATE TYPE is not idempotent — guard with DO block)
DO $$ BEGIN
    CREATE TYPE twin.dim_category AS ENUM (
        'profile','strategy','process','application',
        'integration','organisation','risk','finance','custom'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE twin.dim_category ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE twin.dim_category ADD VALUE IF NOT EXISTS 'integration';

DO $$ BEGIN
    CREATE TYPE twin.visibility_level AS ENUM (
        'public','internal','restricted','confidential'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE twin.rel_type AS ENUM (
        'depends_on','owned_by','supports','risks',
        'enables','part_of','governed_by','replaced_by','custom'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE twin.caller_type AS ENUM (
        'chat_session','crewai_crew','langgraph_agent','api_client'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Core tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS twin.company (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    industry     TEXT        NOT NULL,
    legal_entity TEXT,
    tenant_id    TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_company_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    -- Real composite PK, consistent with every other table here — made
    -- safe by ALSO keeping a standalone UNIQUE(id) below, since every
    -- existing FK (OSS and enterprise) points at company(id) alone and
    -- still needs that to resolve.
    CONSTRAINT pk_company PRIMARY KEY (tenant_id, id),
    CONSTRAINT ux_company_id UNIQUE (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS company_name_tenant_uidx
    ON twin.company (lower(name), tenant_id);
CREATE INDEX IF NOT EXISTS twin_company_tenant_idx ON twin.company (tenant_id);


CREATE TABLE IF NOT EXISTS twin.dim_type (
    id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT,
    name           TEXT              NOT NULL UNIQUE,
    category       twin.dim_category NOT NULL,
    value_schema   JSONB,
    system_defined BOOLEAN           NOT NULL DEFAULT false,
    max_hops       SMALLINT          NOT NULL DEFAULT 2
                                     CHECK (max_hops BETWEEN 1 AND 5),
    created_at     TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dim_type_category_idx ON twin.dim_type (category);

CREATE TABLE IF NOT EXISTS twin.dim_node (
    id                      UUID                  NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               TEXT                  NOT NULL,
    company_id              UUID                  NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    dim_type_id             UUID                  NOT NULL REFERENCES twin.dim_type (id),
    label                   TEXT                  NOT NULL,
    summary                 TEXT,
    tags                    JSONB                 NOT NULL DEFAULT '[]',
    visibility              twin.visibility_level NOT NULL DEFAULT 'internal',
    sensitive               BOOLEAN               NOT NULL DEFAULT false,
    -- entity references: the dim_node holds the FK, not the other way around
    business_application_id TEXT,
    business_process_id     TEXT,
    integration_id          TEXT,
    embedding               VECTOR(1536),
    valid_from              TIMESTAMPTZ           NOT NULL DEFAULT now(),
    valid_to                TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT dim_node_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT chk_dim_node_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    -- Real composite PK on (tenant_id, company_id, id) — the same
    -- tenant/company/asset_id shape as core's direct-owner tables, with
    -- "id" playing the asset_id role here since dim_node has no other
    -- natural business key. Made safe by ALSO keeping a standalone
    -- UNIQUE(id) below, since dim_edge/source_ref/dim_node_attachment/
    -- compliance_impact all FK to dim_node(id) alone and still need that
    -- to resolve.
    CONSTRAINT pk_dim_node PRIMARY KEY (tenant_id, company_id, id),
    CONSTRAINT ux_dim_node_id UNIQUE (id),
    -- Composite FK added ALONGSIDE the existing single-column company_id
    -- FK above (not replacing it) — same isolation guarantee, no breaking
    -- cascade for anything that still relies on the original.
    CONSTRAINT fk_dim_node_company_tenant FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dim_node_company_type_idx ON twin.dim_node (company_id, dim_type_id);
CREATE INDEX IF NOT EXISTS dim_node_active_idx       ON twin.dim_node (company_id, dim_type_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_node_fts_idx          ON twin.dim_node
    USING GIN (to_tsvector('english', coalesce(label,'') || ' ' || coalesce(summary,'')));
CREATE INDEX IF NOT EXISTS dim_node_tags_gin_idx     ON twin.dim_node USING GIN (tags);
CREATE INDEX IF NOT EXISTS dim_node_embedding_idx    ON twin.dim_node
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- Partial unique indexes so each entity links to at most one active dim_node
CREATE UNIQUE INDEX IF NOT EXISTS dim_node_application_id_company_uniq ON twin.dim_node (company_id, business_application_id) WHERE business_application_id IS NOT NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dim_node_process_id_company_uniq     ON twin.dim_node (company_id, business_process_id)     WHERE business_process_id     IS NOT NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dim_node_integration_id_company_uniq ON twin.dim_node (company_id, integration_id)          WHERE integration_id          IS NOT NULL AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS twin.dim_edge (
    id         UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id  TEXT          NOT NULL,
    -- company_id is new here — dim_edge never carried its own company
    -- scope before, relying only on source_id/target_id pointing at a
    -- dim_node that had one. Storing it directly lets the PK and the
    -- FKs below enforce tenant+company consistency without an extra join.
    company_id UUID          NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    source_id  UUID          NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    target_id  UUID          NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    rel_type   twin.rel_type NOT NULL,
    weight     REAL          NOT NULL DEFAULT 0.5 CHECK (weight BETWEEN 0.0 AND 1.0),
    meta       JSONB         NOT NULL DEFAULT '{}',
    valid_from TIMESTAMPTZ   NOT NULL DEFAULT now(),
    valid_to   TIMESTAMPTZ,
    CONSTRAINT dim_edge_no_self_loop CHECK (source_id <> target_id),
    CONSTRAINT dim_edge_valid_range  CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT chk_dim_edge_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    -- Nothing FKs to dim_edge by id, so unlike company/dim_node this is a
    -- real replacement, not an alongside addition.
    CONSTRAINT pk_dim_edge PRIMARY KEY (tenant_id, company_id, id),
    -- Composite FKs added ALONGSIDE the existing single-column source_id/
    -- target_id FKs above. Now includes company_id, so an edge whose
    -- source/target node belongs to a DIFFERENT company than the edge
    -- itself claims is rejected — a real integrity guarantee this never
    -- had before.
    CONSTRAINT fk_dim_edge_company_tenant FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dim_edge_source_tenant FOREIGN KEY (tenant_id, company_id, source_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dim_edge_target_tenant FOREIGN KEY (tenant_id, company_id, target_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dim_edge_source_idx ON twin.dim_edge (source_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_edge_target_idx ON twin.dim_edge (target_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_edge_weight_idx ON twin.dim_edge (weight DESC)         WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS twin.source_ref (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   TEXT        NOT NULL,
    -- company_id is new here — same reasoning as dim_edge above.
    company_id  UUID        NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    dim_node_id UUID        NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    system_name TEXT        NOT NULL,
    external_id TEXT        NOT NULL,
    mcp_tool    TEXT        NOT NULL,
    last_synced TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_ref_unique UNIQUE (dim_node_id, system_name, external_id),
    CONSTRAINT chk_source_ref_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT pk_source_ref PRIMARY KEY (tenant_id, company_id, id),
    CONSTRAINT fk_source_ref_company_tenant FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_source_ref_dim_node_tenant FOREIGN KEY (tenant_id, company_id, dim_node_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS source_ref_node_idx   ON twin.source_ref (dim_node_id);
CREATE INDEX IF NOT EXISTS source_ref_system_idx ON twin.source_ref (system_name, external_id);

CREATE TABLE IF NOT EXISTS twin.dim_node_attachment (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    TEXT        NOT NULL,
    -- company_id is new here — same reasoning as dim_edge above.
    company_id   UUID        NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    node_id      UUID        NOT NULL REFERENCES twin.dim_node(id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT      NOT NULL,
    data         BYTEA       NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_dim_node_attachment_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    CONSTRAINT pk_dim_node_attachment PRIMARY KEY (tenant_id, company_id, id),
    CONSTRAINT fk_dim_node_attachment_company_tenant FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_dim_node_attachment_node_tenant FOREIGN KEY (tenant_id, company_id, node_id) REFERENCES twin.dim_node (tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dim_node_attachment_node_idx ON twin.dim_node_attachment (node_id);

-- context_log — partitioned by quarter
CREATE TABLE IF NOT EXISTS twin.context_log (
    id          UUID             NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   TEXT             NOT NULL,
    company_id  UUID             NOT NULL,
    caller_type twin.caller_type NOT NULL,
    caller_id   TEXT             NOT NULL,
    chunk_ids   UUID[]           NOT NULL,
    tokens_used INTEGER          NOT NULL CHECK (tokens_used > 0),
    llm_target  TEXT,
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    -- created_at (the partition key) must stay in the PK on a partitioned
    -- table; tenant_id/company_id are prepended the same way core's
    -- direct-owner tables lead with tenant_id, company_id. Nothing FKs to
    -- context_log by id, so this is a real replacement of the old PK.
    PRIMARY KEY (tenant_id, company_id, id, created_at),
    CONSTRAINT chk_context_log_tenant_id_present CHECK (tenant_id IS NOT NULL AND btrim(tenant_id) <> ''),
    -- company_id here was always a bare UUID column with no FK at all —
    -- this is a genuinely new constraint, not an addition alongside an
    -- existing one.
    CONSTRAINT fk_context_log_company_tenant FOREIGN KEY (tenant_id, company_id) REFERENCES twin.company (tenant_id, id) ON DELETE CASCADE
) PARTITION BY RANGE (created_at);

-- Quarterly partitions 2025–2026
DO $$ BEGIN
    CREATE TABLE twin.context_log_2025_q1 PARTITION OF twin.context_log FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2025_q2 PARTITION OF twin.context_log FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2025_q3 PARTITION OF twin.context_log FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2025_q4 PARTITION OF twin.context_log FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2026_q1 PARTITION OF twin.context_log FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2026_q2 PARTITION OF twin.context_log FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2026_q3 PARTITION OF twin.context_log FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
    CREATE TABLE twin.context_log_2026_q4 PARTITION OF twin.context_log FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS context_log_company_idx ON twin.context_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_log_caller_idx  ON twin.context_log (caller_type, caller_id);
CREATE INDEX IF NOT EXISTS context_log_chunks_idx  ON twin.context_log USING GIN (chunk_ids);

-- ── Triggers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION twin.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
    CREATE TRIGGER company_updated_at
        BEFORE UPDATE ON twin.company
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER dim_node_updated_at
        BEFORE UPDATE ON twin.dim_node
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── AGE property graph ────────────────────────────────────────────────────────

SELECT * FROM ag_catalog.create_graph('twin_graph')
WHERE NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'twin_graph'
);

-- ── Views ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW twin.active_nodes AS
    SELECT n.*, t.name AS dim_type_name, t.category
    FROM   twin.dim_node n
    JOIN   twin.dim_type t ON t.id = n.dim_type_id
    WHERE  n.valid_to IS NULL;

CREATE OR REPLACE VIEW twin.active_edges AS
    SELECT e.*, s.label AS source_label, tgt.label AS target_label
    FROM   twin.dim_edge  e
    JOIN   twin.dim_node  s   ON s.id = e.source_id
    JOIN   twin.dim_node  tgt ON tgt.id = e.target_id
    WHERE  e.valid_to IS NULL;

CREATE OR REPLACE VIEW twin.node_sources AS
    SELECT n.id, n.company_id, n.label, n.dim_type_id,
           n.visibility, n.sensitive,
           r.system_name, r.external_id, r.mcp_tool, r.last_synced
    FROM   twin.dim_node   n
    JOIN   twin.source_ref r ON r.dim_node_id = n.id
    WHERE  n.valid_to IS NULL;

-- ── RLS (enable; add policies per deployment) ─────────────────────────────────
ALTER TABLE twin.dim_node    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.dim_edge    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.source_ref  ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.context_log ENABLE ROW LEVEL SECURITY;


-- ── 2. Seed data ──────────────────────────────────────────────────────────────
-- (Compliance/audit tables live in enterprise/sql/zz_enterprise_compliance_audit.sql,
-- baked in only when BUILD_MODE=enterprise — see Dockerfile.postgres.enterprise.
-- core.agent_attachment is defined in sql/core/agent_attachment.sql, created
-- by tavro-api's init_tables.py on every app startup — not here, to avoid a
-- duplicate table.)
\echo '[3/3] Loading seed data...'

-- System dim_types (blueprint categories)
INSERT INTO twin.dim_type (name, category, system_defined, max_hops) VALUES
    ('Profile',      'profile',      true, 1),
    ('Strategy',     'strategy',     true, 2),
    ('Process',      'process',      true, 2),
    ('Application',  'application',  true, 2),
    ('Integration',  'integration',  true, 2),
    ('Organisation', 'organisation', true, 2),
    ('Risk',         'risk',         true, 3),
    ('Finance',      'finance',      true, 2),
    ('Custom',       'custom',       false, 2)
ON CONFLICT (name) DO NOTHING;

\echo '======================================================'
\echo ' Setup complete.'
\echo ''
\echo ' Tables created:'
\echo '   twin.company, twin.dim_type, twin.dim_node'
\echo '   twin.dim_edge, twin.source_ref, twin.dim_node_attachment, twin.context_log'
\echo ''
\echo ' Seed data loaded:'
\echo '   10 blueprint dim_types'
\echo ''
\echo ' Next: add companies and run AI research from the UI.'
\echo ' (Enterprise builds additionally load compliance + audit schema —'
\echo '  see enterprise/sql/zz_enterprise_compliance_audit.sql)'
\echo '======================================================'
