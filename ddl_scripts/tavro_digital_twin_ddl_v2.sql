-- =============================================================
-- Tavro Digital Twin DDL v2
-- Fixes: context_log PK includes partition key (created_at)
--        indexes created after partitions exist
-- =============================================================

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;

CREATE SCHEMA IF NOT EXISTS twin;
SET search_path = twin, ag_catalog, public;

-- Enums
CREATE TYPE twin.dim_category AS ENUM (
    'profile','strategy','process','application',
    'organisation','technology','risk','finance','custom'
);
CREATE TYPE twin.visibility_level AS ENUM (
    'public','internal','restricted','confidential'
);
CREATE TYPE twin.rel_type AS ENUM (
    'depends_on','owned_by','supports','risks',
    'enables','part_of','governed_by','replaced_by','custom'
);
CREATE TYPE twin.caller_type AS ENUM (
    'chat_session','crewai_crew','langgraph_agent','api_client'
);

-- company
CREATE TABLE twin.company (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    industry     TEXT        NOT NULL,
    region       TEXT        NOT NULL,
    legal_entity TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX company_name_region_uidx
    ON twin.company (lower(name), lower(region));

-- dim_type
CREATE TABLE twin.dim_type (
    id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT              NOT NULL UNIQUE,
    category       twin.dim_category NOT NULL,
    value_schema   JSONB,
    system_defined BOOLEAN           NOT NULL DEFAULT false,
    max_hops       SMALLINT          NOT NULL DEFAULT 2
                                     CHECK (max_hops BETWEEN 1 AND 5),
    created_at     TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX dim_type_category_idx ON twin.dim_type (category);

-- dim_node
CREATE TABLE twin.dim_node (
    id          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID                  NOT NULL REFERENCES twin.company (id) ON DELETE CASCADE,
    dim_type_id UUID                  NOT NULL REFERENCES twin.dim_type (id),
    label       TEXT                  NOT NULL,
    summary     TEXT,
    tags        JSONB                 NOT NULL DEFAULT '[]',
    visibility  twin.visibility_level NOT NULL DEFAULT 'internal',
    sensitive   BOOLEAN               NOT NULL DEFAULT false,
    embedding   VECTOR(1536),
    valid_from  TIMESTAMPTZ           NOT NULL DEFAULT now(),
    valid_to    TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ           NOT NULL DEFAULT now(),
    CONSTRAINT dim_node_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX dim_node_company_type_idx ON twin.dim_node (company_id, dim_type_id);
CREATE INDEX dim_node_active_idx       ON twin.dim_node (company_id, dim_type_id) WHERE valid_to IS NULL;
CREATE INDEX dim_node_fts_idx          ON twin.dim_node
    USING GIN (to_tsvector('english', coalesce(label,'') || ' ' || coalesce(summary,'')));
CREATE INDEX dim_node_tags_gin_idx     ON twin.dim_node USING GIN (tags);
CREATE INDEX dim_node_embedding_idx    ON twin.dim_node
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- dim_edge
CREATE TABLE twin.dim_edge (
    id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id  UUID          NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    target_id  UUID          NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    rel_type   twin.rel_type NOT NULL,
    weight     REAL          NOT NULL DEFAULT 0.5 CHECK (weight BETWEEN 0.0 AND 1.0),
    meta       JSONB         NOT NULL DEFAULT '{}',
    valid_from TIMESTAMPTZ   NOT NULL DEFAULT now(),
    valid_to   TIMESTAMPTZ,
    CONSTRAINT dim_edge_no_self_loop CHECK (source_id <> target_id),
    CONSTRAINT dim_edge_valid_range  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX dim_edge_source_idx ON twin.dim_edge (source_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX dim_edge_target_idx ON twin.dim_edge (target_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX dim_edge_weight_idx ON twin.dim_edge (weight DESC)         WHERE valid_to IS NULL;

-- source_ref
CREATE TABLE twin.source_ref (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dim_node_id UUID        NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    system_name TEXT        NOT NULL,
    external_id TEXT        NOT NULL,
    mcp_tool    TEXT        NOT NULL,
    last_synced TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_ref_unique UNIQUE (dim_node_id, system_name, external_id)
);
CREATE INDEX source_ref_node_idx   ON twin.source_ref (dim_node_id);
CREATE INDEX source_ref_system_idx ON twin.source_ref (system_name, external_id);

-- context_log — partitioned by month
-- PRIMARY KEY must include created_at (partition key)
CREATE TABLE twin.context_log (
    id          UUID             NOT NULL DEFAULT gen_random_uuid(),
    company_id  UUID             NOT NULL,
    caller_type twin.caller_type NOT NULL,
    caller_id   TEXT             NOT NULL,
    chunk_ids   UUID[]           NOT NULL,
    tokens_used INTEGER          NOT NULL CHECK (tokens_used > 0),
    llm_target  TEXT,
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Quarterly partitions (easier to manage than monthly for dev)
CREATE TABLE twin.context_log_2025_q1 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE twin.context_log_2025_q2 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE twin.context_log_2025_q3 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE twin.context_log_2025_q4 PARTITION OF twin.context_log
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE twin.context_log_2026_q1 PARTITION OF twin.context_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE twin.context_log_2026_q2 PARTITION OF twin.context_log
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');

-- Indexes AFTER partitions are created
CREATE INDEX context_log_company_idx ON twin.context_log (company_id, created_at DESC);
CREATE INDEX context_log_caller_idx  ON twin.context_log (caller_type, caller_id);
CREATE INDEX context_log_chunks_idx  ON twin.context_log USING GIN (chunk_ids);

-- updated_at trigger
CREATE OR REPLACE FUNCTION twin.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER company_updated_at
    BEFORE UPDATE ON twin.company
    FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
CREATE TRIGGER dim_node_updated_at
    BEFORE UPDATE ON twin.dim_node
    FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();

-- AGE graph
SELECT ag_catalog.create_graph('twin_graph');

-- Views
CREATE VIEW twin.active_nodes AS
    SELECT n.*, t.name AS dim_type_name, t.category
    FROM   twin.dim_node n
    JOIN   twin.dim_type t ON t.id = n.dim_type_id
    WHERE  n.valid_to IS NULL;

CREATE VIEW twin.active_edges AS
    SELECT e.*, s.label AS source_label, tgt.label AS target_label
    FROM   twin.dim_edge  e
    JOIN   twin.dim_node  s   ON s.id = e.source_id
    JOIN   twin.dim_node  tgt ON tgt.id = e.target_id
    WHERE  e.valid_to IS NULL;

CREATE VIEW twin.node_sources AS
    SELECT n.id, n.company_id, n.label, n.dim_type_id,
           n.visibility, n.sensitive,
           r.system_name, r.external_id, r.mcp_tool, r.last_synced
    FROM   twin.dim_node   n
    JOIN   twin.source_ref r ON r.dim_node_id = n.id
    WHERE  n.valid_to IS NULL;

-- RLS enabled, policies to be added per deployment
ALTER TABLE twin.dim_node    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.dim_edge    ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.source_ref  ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin.context_log ENABLE ROW LEVEL SECURITY;

-- Seed system dim_types
INSERT INTO twin.dim_type (name, category, system_defined, max_hops) VALUES
    ('Profile',      'profile',      true, 1),
    ('Strategy',     'strategy',     true, 2),
    ('Process',      'process',      true, 2),
    ('Application',  'application',  true, 2),
    ('Organisation', 'organisation', true, 2),
    ('Technology',   'technology',   true, 2),
    ('Risk',         'risk',         true, 3),
    ('Finance',      'finance',      true, 2),
    ('Custom',       'custom',       false, 2);

-- Dimension node attachments (files stored as bytea in Postgres)
CREATE TABLE twin.dim_node_attachment (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id      UUID        NOT NULL REFERENCES twin.dim_node(id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT      NOT NULL,
    data         BYTEA       NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dim_node_attachment_node_idx ON twin.dim_node_attachment (node_id);
