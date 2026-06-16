CREATE TABLE IF NOT EXISTS core.spark_ideas (
    idea_id           TEXT PRIMARY KEY,
    company_id        TEXT NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT,
    rationale         TEXT,
    signal_type       TEXT,
    signal_label      TEXT,
    target_dimensions TEXT[],
    target_nodes      JSONB,
    complexity        TEXT,
    estimated_impact  TEXT,
    similar_agents    JSONB,
    user_reaction     TEXT,
    popularity_score  INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

