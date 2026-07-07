-- Ensures the `twin` schema and its `company` table exist before any sql/core
-- file (e.g. user_preferences.sql) that FKs into twin.company runs.
--
-- Normally twin.company is created by sql/tavro_setup_all.sql, which is only
-- applied via the Postgres image's docker-entrypoint-initdb.d hooks — i.e.
-- once, on first container init. Environments where that hook never ran
-- (e.g. a Postgres instance provisioned outside that image) would otherwise
-- hit "schema twin does not exist" the first time a sql/core file references
-- it. This mirrors that canonical definition exactly so it's a no-op wherever
-- twin.company already exists.

CREATE SCHEMA IF NOT EXISTS twin;

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

-- Needed by user_preferences.sql's updated_at trigger (and normally defined
-- alongside twin.company in tavro_setup_all.sql).
CREATE OR REPLACE FUNCTION twin.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
    CREATE TRIGGER company_updated_at
        BEFORE UPDATE ON twin.company
        FOR EACH ROW EXECUTE FUNCTION twin.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
