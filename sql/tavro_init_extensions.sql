-- =============================================================
-- Tavro — Extension initialisation
-- Auto-run by Docker entrypoint on first container start.
-- For bare-metal: run this manually before the DDL.
-- =============================================================

-- Must be loaded before CREATE EXTENSION
LOAD 'age';

-- Core extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;

-- Set AGE in search path so Cypher functions resolve
-- (also set per-session in application connection strings)
ALTER DATABASE tavro SET search_path = ag_catalog, "$user", public;

-- Confirm
SELECT
    name,
    default_version,
    installed_version,
    comment
FROM pg_available_extensions
WHERE name IN ('age', 'vector', 'pgcrypto')
ORDER BY name;
