CREATE TABLE IF NOT EXISTS core.tool_tables (
  tenant_id  TEXT,
  company_id TEXT,
  tool_id    TEXT,
  tool_name  TEXT,
  table_id   TEXT,
  table_name TEXT,
  created_ts TIMESTAMP,
  updated_ts TIMESTAMP
);

-- High #2 (audit_db/README.md): FK to core.tables (CASCADE). tool_id is
-- NOT FK'd here — core.tools' global-vs-tenant catalog scoping is an open
-- product decision (README Low #4). NOT VALID: safe on a live table with
-- existing data; validate later with
-- ALTER TABLE core.tool_tables VALIDATE CONSTRAINT fk_tool_tables_table;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tool_tables_table') THEN
        ALTER TABLE core.tool_tables
            ADD CONSTRAINT fk_tool_tables_table
            FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tool_tables->tables FK skipped — %', SQLERRM;
END $$;
