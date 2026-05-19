-- =============================================================
-- Tavro Digital Twin — PostgreSQL DDL
-- Requires: pgvector, Apache AGE, pgcrypto extensions
-- Postgres 15+
-- =============================================================

-- -------------------------------------------------------------
-- Extensions
-- -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";         -- pgvector
CREATE EXTENSION IF NOT EXISTS "age";            -- Apache AGE graph
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- -------------------------------------------------------------
-- Schema
-- -------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS twin;
SET search_path = twin, ag_catalog, public;

-- -------------------------------------------------------------
-- Controlled vocabularies (enums)
-- Kept as enums for index efficiency; add values with ALTER TYPE
-- -------------------------------------------------------------

CREATE TYPE twin.dim_category AS ENUM (
    'profile',
    'strategy',
    'process',
    'application',
    'organisation',
    'technology',
    'risk',
    'finance',
    'custom'
);

CREATE TYPE twin.visibility_level AS ENUM (
    'public',       -- any authenticated user
    'internal',     -- company members only
    'restricted',   -- named roles only
    'confidential'  -- admin + data steward only
);

CREATE TYPE twin.rel_type AS ENUM (
    'depends_on',
    'owned_by',
    'supports',
    'risks',
    'enables',
    'part_of',
    'governed_by',
    'replaced_by',
    'custom'
);

CREATE TYPE twin.caller_type AS ENUM (
    'chat_session',
    'crewai_crew',
    'langgraph_agent',
    'api_client'
);

-- -------------------------------------------------------------
-- 1. company
--    Root anchor. One row per enterprise.
--    Partition key for all downstream tables.
-- -------------------------------------------------------------
CREATE TABLE twin.company (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT            NOT NULL,
    industry        TEXT            NOT NULL,
    region          TEXT            NOT NULL,           -- ISO 3166 country/region
    legal_entity    TEXT,                               -- registered legal name if different
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX company_name_region_uidx
    ON twin.company (lower(name), lower(region));

COMMENT ON TABLE twin.company IS
    'Root anchor for a digital twin. One row per enterprise. '
    'All other twin tables foreign-key to this via company_id.';

-- -------------------------------------------------------------
-- 2. dim_type
--    Registry of dimension types. Schema-free extensibility:
--    adding a new dimension is one INSERT here, no DDL change.
-- -------------------------------------------------------------
CREATE TABLE twin.dim_type (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT            NOT NULL UNIQUE,    -- e.g. 'Application', 'Risk'
    category        twin.dim_category NOT NULL,
    value_schema    JSONB,                              -- optional JSON Schema stub for summary validation
    system_defined  BOOLEAN         NOT NULL DEFAULT false,
    max_hops        SMALLINT        NOT NULL DEFAULT 2  -- traversal depth hint for context agent
                                    CHECK (max_hops BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX dim_type_category_idx ON twin.dim_type (category);

COMMENT ON TABLE twin.dim_type IS
    'Registry of all dimension types. system_defined=true rows are '
    'seeded by Tavro; user-defined rows have system_defined=false. '
    'max_hops controls how many relationship hops the context agent '
    'will traverse from this node type before stopping.';

-- -------------------------------------------------------------
-- 3. dim_node
--    The core of the twin. One row = one dimension instance
--    for one company. Stores a label, a short summary, tags,
--    access metadata, and a pgvector embedding.
--    Temporally bounded via valid_from / valid_to.
-- -------------------------------------------------------------
CREATE TABLE twin.dim_node (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID                NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    dim_type_id     UUID                NOT NULL REFERENCES twin.dim_type (id),
    label           TEXT                NOT NULL,               -- human name, e.g. "SAP ERP"
    summary         TEXT,                                       -- 2-5 sentences; what the context agent retrieves
    tags            JSONB               NOT NULL DEFAULT '[]',  -- keyword array for pre-filter
    visibility      twin.visibility_level NOT NULL DEFAULT 'internal',
    sensitive       BOOLEAN             NOT NULL DEFAULT false, -- triggers PII redaction in policy gate
    embedding       VECTOR(1536),                               -- pgvector; dimension matches embedding model
    valid_from      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,                                -- NULL = currently active
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT dim_node_valid_range
        CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Partition-friendly index: company first, then type
CREATE INDEX dim_node_company_type_idx
    ON twin.dim_node (company_id, dim_type_id);

-- Active-only partial index (most queries filter valid_to IS NULL)
CREATE INDEX dim_node_active_idx
    ON twin.dim_node (company_id, dim_type_id)
    WHERE valid_to IS NULL;

-- Full-text search on label + summary
CREATE INDEX dim_node_fts_idx
    ON twin.dim_node
    USING GIN (to_tsvector('english', coalesce(label, '') || ' ' || coalesce(summary, '')));

-- pgvector HNSW index for ANN similarity search
-- Start with IVFFlat for smaller datasets; swap to HNSW at ~500k rows
CREATE INDEX dim_node_embedding_hnsw_idx
    ON twin.dim_node
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Tags GIN index for @> containment queries
CREATE INDEX dim_node_tags_gin_idx
    ON twin.dim_node USING GIN (tags);

COMMENT ON TABLE twin.dim_node IS
    'Core dimension instance. label + summary are the only text '
    'the twin stores; full detail stays in the source system '
    'and is fetched on demand via source_ref. '
    'valid_to IS NULL means the node is currently active. '
    'sensitive=true causes the policy gate to redact the summary '
    'before passing context to any LLM.';

COMMENT ON COLUMN twin.dim_node.embedding IS
    'Vector embedding of (label || summary || tags). '
    'Dimension must match the embedding model in use '
    '(1536 for text-embedding-3-small / Nomic Embed v1.5). '
    'Recomputed on any write to label, summary, or tags.';

COMMENT ON COLUMN twin.dim_node.summary IS
    'Plain text, 2-5 sentences maximum. This is the only '
    'content the context agent returns to an LLM. '
    'If more detail is needed, the caller fetches via source_ref.';

-- -------------------------------------------------------------
-- 4. dim_edge
--    Typed, weighted, time-bounded relationship between two
--    dim_nodes. Lives in both Postgres (for relational queries)
--    and Apache AGE (for Cypher traversal). Keep in sync via
--    application layer or trigger.
-- -------------------------------------------------------------
CREATE TABLE twin.dim_edge (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID            NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    target_id       UUID            NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    rel_type        twin.rel_type   NOT NULL,
    weight          REAL            NOT NULL DEFAULT 0.5
                                    CHECK (weight BETWEEN 0.0 AND 1.0),
    meta            JSONB           NOT NULL DEFAULT '{}',  -- e.g. {"criticality":"high"}
    valid_from      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,

    CONSTRAINT dim_edge_no_self_loop CHECK (source_id <> target_id),
    CONSTRAINT dim_edge_valid_range  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Traversal indexes
CREATE INDEX dim_edge_source_idx   ON twin.dim_edge (source_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX dim_edge_target_idx   ON twin.dim_edge (target_id, rel_type) WHERE valid_to IS NULL;

-- Weight-based ordering (used by result merger scorer)
CREATE INDEX dim_edge_weight_idx   ON twin.dim_edge (weight DESC) WHERE valid_to IS NULL;

COMMENT ON TABLE twin.dim_edge IS
    'Typed relationship between two dim_nodes. '
    'weight (0-1) drives relevance scoring in the context agent. '
    'meta is an open JSONB bag for edge annotations — '
    'no schema change required to add new edge properties. '
    'Mirrored into Apache AGE graph for Cypher traversal.';

-- -------------------------------------------------------------
-- 5. source_ref
--    The bridge to source systems. Each dim_node can have
--    multiple source refs (e.g. a node may exist in both
--    ServiceNow and an internal wiki). mcp_tool is the name
--    of the FastMCP tool the context agent calls for drill-down.
-- -------------------------------------------------------------
CREATE TABLE twin.source_ref (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    dim_node_id     UUID            NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    system_name     TEXT            NOT NULL,    -- e.g. 'ServiceNow', 'Confluence', 'SAP'
    external_id     TEXT            NOT NULL,    -- record ID in that system
    mcp_tool        TEXT            NOT NULL,    -- FastMCP tool name to call for detail
    last_synced     TIMESTAMPTZ,                 -- last time metadata was refreshed from source
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT source_ref_unique UNIQUE (dim_node_id, system_name, external_id)
);

CREATE INDEX source_ref_node_idx    ON twin.source_ref (dim_node_id);
CREATE INDEX source_ref_system_idx  ON twin.source_ref (system_name, external_id);

COMMENT ON TABLE twin.source_ref IS
    'Pointer from a dim_node to its authoritative record in a '
    'source system. mcp_tool is the FastMCP server tool the '
    'context agent invokes when a caller requests detail beyond '
    'what is stored in dim_node.summary.';

-- -------------------------------------------------------------
-- 6. context_log
--    Audit record written by the context serialiser before
--    returning a result to any caller. Partitioned by month.
-- -------------------------------------------------------------
CREATE TABLE twin.context_log (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID            NOT NULL REFERENCES twin.company (id),
    caller_type     twin.caller_type NOT NULL,
    caller_id       TEXT            NOT NULL,   -- session_id, crew_id, agent_id, etc.
    chunk_ids       UUID[]          NOT NULL,   -- dim_node IDs included in this context slice
    tokens_used     INTEGER         NOT NULL CHECK (tokens_used > 0),
    llm_target      TEXT,                       -- model identifier, e.g. 'gpt-4o', 'claude-3-5-sonnet'
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Initial monthly partitions — extend as needed
CREATE TABLE twin.context_log_2025_01 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE twin.context_log_2025_02 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE twin.context_log_2025_03 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE twin.context_log_2025_04 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE twin.context_log_2025_05 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE twin.context_log_2025_06 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE twin.context_log_2025_07 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE twin.context_log_2025_08 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE twin.context_log_2025_09 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE twin.context_log_2025_10 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE twin.context_log_2025_11 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE twin.context_log_2025_12 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE twin.context_log_2026_01 PARTITION OF twin.context_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Indexes on parent table propagate to all partitions
CREATE INDEX context_log_company_idx  ON twin.context_log (company_id, created_at DESC);
CREATE INDEX context_log_caller_idx   ON twin.context_log (caller_type, caller_id);
CREATE INDEX context_log_chunks_idx   ON twin.context_log USING GIN (chunk_ids);

COMMENT ON TABLE twin.context_log IS
    'Immutable audit trail. Written before the context serialiser '
    'returns. chunk_ids allows reconstruction of exactly what '
    'the system knew at query time. Partitioned by month; '
    'archive partitions older than your retention window.';

-- -------------------------------------------------------------
-- Triggers: updated_at auto-maintenance
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION twin.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER company_updated_at
    BEFORE UPDATE ON twin.company
    FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();

CREATE TRIGGER dim_node_updated_at
    BEFORE UPDATE ON twin.dim_node
    FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();

-- -------------------------------------------------------------
-- Apache AGE graph mirror
--    The dim_edge table is the source of truth.
--    Application layer (or the trigger below) keeps AGE in sync.
--    The graph stores node IDs and edge type only — all
--    properties are resolved from Postgres when needed.
-- -------------------------------------------------------------
SELECT ag_catalog.create_graph('twin_graph');

-- Optional: trigger to sync dim_edge inserts into AGE
-- Uncomment if you want automatic sync; otherwise handle in app layer.
--
-- CREATE OR REPLACE FUNCTION twin.sync_edge_to_age()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN
--     PERFORM ag_catalog.cypher(
--         'twin_graph',
--         format(
--             'MERGE (s:DimNode {id: %L})
--              MERGE (t:DimNode {id: %L})
--              MERGE (s)-[r:%s {id: %L, weight: %s}]->(t)',
--             NEW.source_id::text,
--             NEW.target_id::text,
--             upper(NEW.rel_type::text),
--             NEW.id::text,
--             NEW.weight
--         ),
--         NULL
--     );
--     RETURN NEW;
-- END;
-- $$;
--
-- CREATE TRIGGER dim_edge_age_sync
--     AFTER INSERT ON twin.dim_edge
--     FOR EACH ROW EXECUTE FUNCTION twin.sync_edge_to_age();

-- -------------------------------------------------------------
-- Seed: system-defined dim_types
-- -------------------------------------------------------------
INSERT INTO twin.dim_type (name, category, system_defined, max_hops) VALUES
    ('Profile',       'profile',      true, 1),
    ('Strategy',      'strategy',     true, 2),
    ('Process',       'process',      true, 2),
    ('Application',   'application',  true, 2),
    ('Organisation',  'organisation', true, 2),
    ('Technology',    'technology',   true, 2),
    ('Risk',          'risk',         true, 3),
    ('Finance',       'finance',      true, 2),
    ('Custom',        'custom',       false, 2);

-- -------------------------------------------------------------
-- Useful views
-- -------------------------------------------------------------

-- Active nodes only (most common query pattern)
CREATE VIEW twin.active_nodes AS
    SELECT n.*, t.name AS dim_type_name, t.category
    FROM   twin.dim_node  n
    JOIN   twin.dim_type  t ON t.id = n.dim_type_id
    WHERE  n.valid_to IS NULL;

-- Active edges only
CREATE VIEW twin.active_edges AS
    SELECT e.*,
           s.label AS source_label,
           tgt.label AS target_label
    FROM   twin.dim_edge  e
    JOIN   twin.dim_node  s   ON s.id = e.source_id
    JOIN   twin.dim_node  tgt ON tgt.id = e.target_id
    WHERE  e.valid_to IS NULL;

-- Node with its source references (for context agent drill-down lookup)
CREATE VIEW twin.node_sources AS
    SELECT n.id, n.company_id, n.label, n.dim_type_id,
           n.visibility, n.sensitive,
           r.system_name, r.external_id, r.mcp_tool, r.last_synced
    FROM   twin.dim_node   n
    JOIN   twin.source_ref r ON r.dim_node_id = n.id
    WHERE  n.valid_to IS NULL;

-- -------------------------------------------------------------
-- Row-level security (enable when multi-tenant auth is in place)
-- -------------------------------------------------------------
ALTER TABLE twin.dim_node    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.dim_edge    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.source_ref  ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.context_log ENABLE ROW LEVEL SECURITY;

-- Placeholder policy — replace with your auth token → company_id resolution
-- Example for a Postgres role per company:
-- CREATE POLICY company_isolation ON twin.dim_node
--     USING (company_id = current_setting('app.current_company_id')::uuid);
