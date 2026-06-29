-- =============================================================
-- Tavro Portal — Master Database Setup Script
-- Version: 2025-05
-- Run order: extensions → core schema → compliance → audit → seed data
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
\echo '[1/5] Loading extensions...'

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;
ALTER DATABASE tavro SET search_path = ag_catalog, "$user", public;


-- ── 1. Schema & core types ────────────────────────────────────────────────────
\echo '[2/5] Creating core schema...'

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
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    industry     TEXT        NOT NULL,
    region       TEXT        NOT NULL,
    legal_entity TEXT,
    tenant_id    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_name_region_tenant_uidx
    ON twin.company (lower(name), lower(region), tenant_id);
CREATE INDEX IF NOT EXISTS twin_company_tenant_idx ON twin.company (tenant_id);


CREATE TABLE IF NOT EXISTS twin.dim_type (
    id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX IF NOT EXISTS dim_node_company_type_idx ON twin.dim_node (company_id, dim_type_id);
CREATE INDEX IF NOT EXISTS dim_node_active_idx       ON twin.dim_node (company_id, dim_type_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_node_fts_idx          ON twin.dim_node
    USING GIN (to_tsvector('english', coalesce(label,'') || ' ' || coalesce(summary,'')));
CREATE INDEX IF NOT EXISTS dim_node_tags_gin_idx     ON twin.dim_node USING GIN (tags);
CREATE INDEX IF NOT EXISTS dim_node_embedding_idx    ON twin.dim_node
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS twin.dim_edge (
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
CREATE INDEX IF NOT EXISTS dim_edge_source_idx ON twin.dim_edge (source_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_edge_target_idx ON twin.dim_edge (target_id, rel_type) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS dim_edge_weight_idx ON twin.dim_edge (weight DESC)         WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS twin.source_ref (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dim_node_id UUID        NOT NULL REFERENCES twin.dim_node (id) ON DELETE CASCADE,
    system_name TEXT        NOT NULL,
    external_id TEXT        NOT NULL,
    mcp_tool    TEXT        NOT NULL,
    last_synced TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_ref_unique UNIQUE (dim_node_id, system_name, external_id)
);
CREATE INDEX IF NOT EXISTS source_ref_node_idx   ON twin.source_ref (dim_node_id);
CREATE INDEX IF NOT EXISTS source_ref_system_idx ON twin.source_ref (system_name, external_id);

CREATE TABLE IF NOT EXISTS twin.dim_node_attachment (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id      UUID        NOT NULL REFERENCES twin.dim_node(id) ON DELETE CASCADE,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT      NOT NULL,
    data         BYTEA       NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dim_node_attachment_node_idx ON twin.dim_node_attachment (node_id);

-- context_log — partitioned by quarter
CREATE TABLE IF NOT EXISTS twin.context_log (
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


-- ── 2. Compliance layer ───────────────────────────────────────────────────────
\echo '[3/5] Creating compliance tables...'

CREATE TABLE IF NOT EXISTS twin.compliance_dim_type (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    scope           TEXT NOT NULL DEFAULT 'both',
    system_defined  BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, scope)
);

CREATE TABLE IF NOT EXISTS twin.compliance_item (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_type           TEXT NOT NULL CHECK (item_type IN ('regulation', 'policy')),
    scope               TEXT NOT NULL CHECK (scope IN ('external', 'internal')) DEFAULT 'external',
    name                TEXT NOT NULL,
    short_name          TEXT,
    description         TEXT,
    issuing_body        TEXT,
    jurisdiction        TEXT[],
    industry_tags       TEXT[],
    company_id          UUID REFERENCES twin.company(id) ON DELETE CASCADE,
    effective_date      DATE,
    review_date         DATE,
    sunset_date         DATE,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft','active','superseded','archived')),
    ai_researched       BOOLEAN NOT NULL DEFAULT false,
    ai_research_notes   TEXT,
    research_sources    TEXT[],
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT,
    CONSTRAINT chk_policy_has_company
        CHECK (item_type = 'regulation' OR company_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS compliance_item_type_idx    ON twin.compliance_item (item_type, status);
CREATE INDEX IF NOT EXISTS compliance_item_company_idx ON twin.compliance_item (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_item_name_idx    ON twin.compliance_item USING GIN(to_tsvector('english', name));

CREATE TABLE IF NOT EXISTS twin.compliance_dimension (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_item_id   UUID NOT NULL REFERENCES twin.compliance_item(id) ON DELETE CASCADE,
    dim_type_id          UUID NOT NULL REFERENCES twin.compliance_dim_type(id),
    label                TEXT NOT NULL,
    summary              TEXT,
    tags                 JSONB NOT NULL DEFAULT '[]',
    visibility           TEXT NOT NULL DEFAULT 'internal'
                         CHECK (visibility IN ('public','internal','restricted','confidential')),
    sensitive            BOOLEAN NOT NULL DEFAULT false,
    sort_order           INT NOT NULL DEFAULT 0,
    valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to             TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_dim_item_idx ON twin.compliance_dimension (compliance_item_id);
CREATE INDEX IF NOT EXISTS compliance_dim_type_idx ON twin.compliance_dimension (dim_type_id);

CREATE TABLE IF NOT EXISTS twin.compliance_impact (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_item_id   UUID NOT NULL REFERENCES twin.compliance_item(id) ON DELETE CASCADE,
    company_id           UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,
    dim_node_id          UUID REFERENCES twin.dim_node(id) ON DELETE SET NULL,
    impact_level         TEXT NOT NULL DEFAULT 'medium'
                         CHECK (impact_level IN ('critical','high','medium','low','none')),
    impact_type          TEXT[] NOT NULL DEFAULT '{}',
    gap_description      TEXT,
    gap_status           TEXT NOT NULL DEFAULT 'open'
                         CHECK (gap_status IN ('open','in_progress','closed','accepted','not_applicable')),
    current_state        TEXT,
    target_state         TEXT,
    remediation_plan     TEXT,
    due_date             DATE,
    evidence_notes       TEXT,
    last_assessed        TIMESTAMPTZ,
    assessed_by          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (compliance_item_id, company_id, dim_node_id)
);
CREATE INDEX IF NOT EXISTS compliance_impact_item_idx    ON twin.compliance_impact (compliance_item_id);
CREATE INDEX IF NOT EXISTS compliance_impact_company_idx ON twin.compliance_impact (company_id);
CREATE INDEX IF NOT EXISTS compliance_impact_node_idx    ON twin.compliance_impact (dim_node_id) WHERE dim_node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_impact_level_idx   ON twin.compliance_impact (impact_level);

CREATE TABLE IF NOT EXISTS twin.compliance_document (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_item_id   UUID NOT NULL REFERENCES twin.compliance_item(id) ON DELETE CASCADE,
    doc_type             TEXT NOT NULL DEFAULT 'source'
                         CHECK (doc_type IN ('source','summary','guidance','evidence','audit','policy_text','custom')),
    title                TEXT NOT NULL,
    filename             TEXT,
    mime_type            TEXT,
    file_size_bytes      INT,
    content_text         TEXT,
    source_url           TEXT,
    ai_summary           TEXT,
    ai_key_points        JSONB,
    ai_processed         BOOLEAN NOT NULL DEFAULT false,
    version              TEXT,
    effective_date       DATE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_doc_item_idx ON twin.compliance_document (compliance_item_id);

CREATE TABLE IF NOT EXISTS public.agent_attachment (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id             TEXT NOT NULL,
    filename             TEXT NOT NULL,
    mime_type            TEXT,
    file_size_bytes      INT NOT NULL,
    file_data            BYTEA NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_attachment_agent_idx ON public.agent_attachment (agent_id, created_at DESC);

-- Compliance triggers
DO $$ BEGIN
    CREATE TRIGGER compliance_item_updated_at
        BEFORE UPDATE ON twin.compliance_item
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER compliance_dim_updated_at
        BEFORE UPDATE ON twin.compliance_dimension
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER compliance_impact_updated_at
        BEFORE UPDATE ON twin.compliance_impact
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. Audit layer ────────────────────────────────────────────────────────────
\echo '[4/5] Creating audit tables...'

CREATE TABLE IF NOT EXISTS twin.audit_run (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,
    scope_type        TEXT NOT NULL CHECK (scope_type IN (
                          'single','use_case_all','catalog_single','full'
                      )),
    use_case_id       TEXT,
    use_case_name     TEXT,
    agent_id          TEXT,
    agent_name        TEXT,
    compliance_item_id UUID REFERENCES twin.compliance_item(id) ON DELETE SET NULL,
    compliance_item_name TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed','cancelled')),
    total_pairs       INT NOT NULL DEFAULT 0,
    completed_pairs   INT NOT NULL DEFAULT 0,
    failed_pairs      INT NOT NULL DEFAULT 0,
    summary_text      TEXT,
    overall_risk      TEXT CHECK (overall_risk IN ('critical','high','medium','low','none')),
    orchestrator_session_id TEXT,
    error_message     TEXT,
    initiated_by      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS audit_run_company_idx  ON twin.audit_run (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_run_status_idx   ON twin.audit_run (status);
CREATE INDEX IF NOT EXISTS audit_run_usecase_idx  ON twin.audit_run (use_case_id) WHERE use_case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS twin.audit_finding (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_run_id          UUID NOT NULL REFERENCES twin.audit_run(id) ON DELETE CASCADE,
    company_id            UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,
    use_case_id           TEXT NOT NULL,
    use_case_name         TEXT NOT NULL,
    compliance_item_id    UUID REFERENCES twin.compliance_item(id) ON DELETE SET NULL,
    compliance_item_name  TEXT NOT NULL,
    compliance_item_type  TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','completed','failed','skipped')),
    risk_level            TEXT CHECK (risk_level IN ('critical','high','medium','low','none')),
    risk_score            INT,
    confidence            INT,
    applicable_rules      JSONB,
    gaps                  JSONB,
    compliant_areas       JSONB,
    recommendations       JSONB,
    summary               TEXT,
    agent_session_id      TEXT,
    tokens_used           INT,
    assessment_duration_ms INT,
    error_message         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_finding_run_idx       ON twin.audit_finding (audit_run_id);
CREATE INDEX IF NOT EXISTS audit_finding_company_idx   ON twin.audit_finding (company_id);
CREATE INDEX IF NOT EXISTS audit_finding_usecase_idx   ON twin.audit_finding (use_case_id);
CREATE INDEX IF NOT EXISTS audit_finding_risk_idx      ON twin.audit_finding (risk_level);
CREATE INDEX IF NOT EXISTS audit_finding_status_idx    ON twin.audit_finding (status);

DO $$ BEGIN
    CREATE TRIGGER audit_run_updated_at
        BEFORE UPDATE ON twin.audit_run
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER audit_finding_updated_at
        BEFORE UPDATE ON twin.audit_finding
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 4. Seed data ──────────────────────────────────────────────────────────────
\echo '[5/5] Loading seed data...'

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

-- Compliance dimension types
INSERT INTO twin.compliance_dim_type (name, category, scope, system_defined) VALUES
    ('Regulatory Scope',          'scope',       'regulation', true),
    ('Applicability',             'scope',       'both',       true),
    ('Key Requirement',           'requirement', 'both',       true),
    ('Prohibited Activity',       'requirement', 'regulation', true),
    ('Mandatory Control',         'control',     'both',       true),
    ('Compliance Deadline',       'deadline',    'both',       true),
    ('Penalty & Enforcement',     'penalty',     'regulation', true),
    ('Audit Requirement',         'audit',       'both',       true),
    ('Compliance Evidence',       'audit',       'policy',     true),
    ('Impact on Business',        'impact',      'both',       true),
    ('Implementation Guidance',   'control',     'policy',     true),
    ('Exception Process',         'control',     'policy',     true),
    ('Reporting Obligation',      'requirement', 'regulation', true),
    ('Data Subject Right',        'requirement', 'regulation', true),
    ('Custom',                    'custom',       'both',      false)
ON CONFLICT DO NOTHING;

-- Seed regulations (shared — no company_id)
WITH regulation_seed
    (item_type, scope, name, short_name, description, issuing_body, jurisdiction, industry_tags, status, ai_researched)
AS (
    VALUES
        ('regulation', 'external',
         'Bank Secrecy Act / Anti-Money Laundering', 'BSA/AML',
         'Federal law requiring financial institutions to assist government agencies in detecting and preventing money laundering.',
         'FinCEN / Federal Reserve', ARRAY['US'], ARRAY['banking','fintech','credit-union'],
         'active', false),

        ('regulation', 'external',
         'Dodd-Frank Wall Street Reform and Consumer Protection Act', 'Dodd-Frank',
         'Comprehensive financial reform legislation enacted in response to the 2008 financial crisis.',
         'US Congress / CFPB / SEC', ARRAY['US'], ARRAY['banking','securities','insurance'],
         'active', false),

        ('regulation', 'external',
         'General Data Protection Regulation', 'GDPR',
         'EU regulation on data protection and privacy for individuals within the EU and EEA.',
         'European Data Protection Board', ARRAY['EU','EEA'],
         ARRAY['all-industries','technology','banking','healthcare'],
         'active', false),

        ('regulation', 'external',
         'Health Insurance Portability and Accountability Act', 'HIPAA',
         'US law providing data privacy and security provisions for safeguarding medical information.',
         'HHS / OCR', ARRAY['US'], ARRAY['healthcare','insurance','technology'],
         'active', false),

        ('regulation', 'external',
         'OCC Heightened Standards for Large Financial Institutions', 'OCC Heightened Standards',
         'OCC guidelines establishing minimum standards for the design and implementation of a risk governance framework.',
         'OCC', ARRAY['US'], ARRAY['banking'],
         'active', false),

        ('regulation', 'external',
         'Equal Credit Opportunity Act', 'ECOA',
         'Federal law prohibiting creditors from discriminating against credit applicants on the basis of race, color, religion, national origin, sex, marital status, age, or receipt of public assistance.',
         'CFPB / Federal Reserve', ARRAY['US'], ARRAY['banking','fintech','lending'],
         'active', false),

        ('regulation', 'external',
         'Gramm-Leach-Bliley Act', 'GLBA',
         'Requires financial institutions to explain how they share and protect their customers'' private information.',
         'Federal Trade Commission', ARRAY['US'], ARRAY['banking','insurance','fintech'],
         'active', false)
)
INSERT INTO twin.compliance_item
    (item_type, scope, name, short_name, description, issuing_body, jurisdiction, industry_tags, status, ai_researched)
SELECT
    s.item_type, s.scope, s.name, s.short_name, s.description, s.issuing_body,
    s.jurisdiction, s.industry_tags, s.status, s.ai_researched
FROM regulation_seed s
WHERE NOT EXISTS (
    SELECT 1
    FROM twin.compliance_item ci
    WHERE ci.item_type = s.item_type
      AND ci.name = s.name
      AND COALESCE(ci.short_name, '') = COALESCE(s.short_name, '')
);

\echo '======================================================'
\echo ' Setup complete.'
\echo ''
\echo ' Tables created:'
\echo '   twin.company, twin.dim_type, twin.dim_node'
\echo '   twin.dim_edge, twin.source_ref, twin.dim_node_attachment, twin.context_log'
\echo '   twin.compliance_dim_type, twin.compliance_item'
\echo '   twin.compliance_dimension, twin.compliance_impact'
\echo '   twin.compliance_document, public.agent_attachment'
\echo '   twin.audit_run, twin.audit_finding'
\echo ''
\echo ' Seed data loaded:'
\echo '   10 blueprint dim_types'
\echo '   15 compliance dim_types'
\echo '   7 seeded regulations'
\echo ''
\echo ' Next: add companies and run AI research from the UI.'
\echo '======================================================'
