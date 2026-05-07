-- =============================================================
-- sql/compliance_ddl.sql
-- Compliance Layer — Regulations & Policies
-- Run after tavro_digital_twin_ddl_v2.sql
-- =============================================================

-- ── Compliance item type registry ─────────────────────────────────────────────
-- Defines the dimension categories available for compliance items.

CREATE TABLE IF NOT EXISTS twin.compliance_dim_type (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,   -- scope|requirement|deadline|penalty|control|audit|impact|custom
    scope           TEXT NOT NULL DEFAULT 'both',  -- regulation|policy|both
    system_defined  BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, scope)
);

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
    ('Custom',                    'custom',      'both',       false)
ON CONFLICT DO NOTHING;


-- ── Compliance item (regulation or policy) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS twin.compliance_item (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Type discriminator
    item_type           TEXT NOT NULL CHECK (item_type IN ('regulation', 'policy')),
    scope               TEXT NOT NULL CHECK (scope IN ('external', 'internal')) DEFAULT 'external',

    -- Identity
    name                TEXT NOT NULL,
    short_name          TEXT,                    -- e.g. "GDPR", "BSA", "OCC-2023-37"
    description         TEXT,
    issuing_body        TEXT,                    -- e.g. "OCC", "SEC", "Federal Register"
    jurisdiction        TEXT[],                  -- e.g. ['US', 'EU'] or ['US-FL']
    industry_tags       TEXT[],                  -- e.g. ['banking', 'fintech']

    -- For policies: owning company (required); for regs: null (shared)
    company_id          UUID REFERENCES twin.company(id) ON DELETE CASCADE,

    -- Dates
    effective_date      DATE,
    review_date         DATE,
    sunset_date         DATE,

    -- Status
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft','active','superseded','archived')),

    -- AI research
    ai_researched       BOOLEAN NOT NULL DEFAULT false,
    ai_research_notes   TEXT,
    research_sources    TEXT[],

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT,

    -- Constraints
    CONSTRAINT chk_policy_has_company
        CHECK (item_type = 'regulation' OR company_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS compliance_item_type_idx    ON twin.compliance_item (item_type, status);
CREATE INDEX IF NOT EXISTS compliance_item_company_idx ON twin.compliance_item (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_item_name_idx    ON twin.compliance_item USING gin(to_tsvector('english', name));


-- ── Compliance dimension ──────────────────────────────────────────────────────
-- Same pattern as twin.dim_node but scoped to a compliance item.

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


-- ── Compliance impact ─────────────────────────────────────────────────────────
-- Per-company impact assessment linking a compliance item to blueprint dimensions.

CREATE TABLE IF NOT EXISTS twin.compliance_impact (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_item_id   UUID NOT NULL REFERENCES twin.compliance_item(id) ON DELETE CASCADE,
    company_id           UUID NOT NULL REFERENCES twin.company(id) ON DELETE CASCADE,

    -- Link to the affected blueprint dimension (optional — can be item-level)
    dim_node_id          UUID REFERENCES twin.dim_node(id) ON DELETE SET NULL,

    -- Impact assessment
    impact_level         TEXT NOT NULL DEFAULT 'medium'
                         CHECK (impact_level IN ('critical','high','medium','low','none')),
    impact_type          TEXT[] NOT NULL DEFAULT '{}',
                         -- financial|operational|reputational|regulatory|strategic

    -- Gap analysis
    gap_description      TEXT,                   -- what the company needs to do
    gap_status           TEXT NOT NULL DEFAULT 'open'
                         CHECK (gap_status IN ('open','in_progress','closed','accepted','not_applicable')),
    current_state        TEXT,                   -- what the company currently has
    target_state         TEXT,                   -- what the regulation/policy requires
    remediation_plan     TEXT,
    due_date             DATE,

    -- Evidence
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


-- ── Compliance document ───────────────────────────────────────────────────────
-- Supporting documents for regulations and policies.

CREATE TABLE IF NOT EXISTS twin.compliance_document (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compliance_item_id   UUID NOT NULL REFERENCES twin.compliance_item(id) ON DELETE CASCADE,

    -- Document identity
    doc_type             TEXT NOT NULL DEFAULT 'source'
                         CHECK (doc_type IN ('source','summary','guidance','evidence','audit','policy_text','custom')),
    title                TEXT NOT NULL,

    -- Content sources (one of these will be populated)
    filename             TEXT,                   -- for uploaded files
    mime_type            TEXT,
    file_size_bytes      INT,
    content_text         TEXT,                   -- extracted text (from PDF or URL)
    source_url           TEXT,                   -- for web-fetched documents

    -- AI processing
    ai_summary           TEXT,                   -- AI-generated summary of this document
    ai_key_points        JSONB,                  -- extracted key points as JSON array
    ai_processed         BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    version              TEXT,
    effective_date       DATE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_doc_item_idx ON twin.compliance_document (compliance_item_id);


-- ── Trigger: updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION twin.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

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

-- ── Seed: sample regulations ──────────────────────────────────────────────────

INSERT INTO twin.compliance_item (item_type, scope, name, short_name, description, issuing_body, jurisdiction, industry_tags, status, ai_researched)
VALUES
    ('regulation', 'external',
     'Bank Secrecy Act / Anti-Money Laundering',
     'BSA/AML',
     'Federal law requiring financial institutions to assist government agencies in detecting and preventing money laundering.',
     'FinCEN / Federal Reserve',
     ARRAY['US'],
     ARRAY['banking','fintech','credit-union'],
     'active', false),

    ('regulation', 'external',
     'Dodd-Frank Wall Street Reform and Consumer Protection Act',
     'Dodd-Frank',
     'Comprehensive financial reform legislation enacted in response to the 2008 financial crisis.',
     'US Congress / CFPB / SEC',
     ARRAY['US'],
     ARRAY['banking','securities','insurance'],
     'active', false),

    ('regulation', 'external',
     'General Data Protection Regulation',
     'GDPR',
     'EU regulation on data protection and privacy for individuals within the EU and EEA.',
     'European Data Protection Board',
     ARRAY['EU','EEA'],
     ARRAY['all-industries','technology','banking','healthcare'],
     'active', false),

    ('regulation', 'external',
     'Health Insurance Portability and Accountability Act',
     'HIPAA',
     'US law providing data privacy and security provisions for safeguarding medical information.',
     'HHS / OCR',
     ARRAY['US'],
     ARRAY['healthcare','insurance','technology'],
     'active', false),

    ('regulation', 'external',
     'OCC Heightened Standards for Large Financial Institutions',
     'OCC Heightened Standards',
     'OCC guidelines establishing minimum standards for the design and implementation of a risk governance framework.',
     'OCC',
     ARRAY['US'],
     ARRAY['banking'],
     'active', false)
ON CONFLICT DO NOTHING;
