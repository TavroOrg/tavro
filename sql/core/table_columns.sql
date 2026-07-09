CREATE TABLE IF NOT EXISTS core.table_columns (
  tenant_id   TEXT,
  company_id  TEXT,
  table_id    TEXT,
  table_name  TEXT,
  column_name TEXT,
  column_id   TEXT,
  created_ts  TIMESTAMP,
  updated_ts  TIMESTAMP
);

-- High #2 (audit_db/README.md): FK to core.tables (CASCADE — junction row
-- is meaningless without the table) and FK to core.columns (RESTRICT —
-- protect the shared column-name catalog entry). Single-column: neither
-- tables nor columns was part of the Critical #2 composite rollout.
-- NOT VALID: safe on a live table with existing data; validate later with
-- ALTER TABLE core.table_columns VALIDATE CONSTRAINT fk_table_columns_table;
-- ALTER TABLE core.table_columns VALIDATE CONSTRAINT fk_table_columns_column;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_table_columns_table') THEN
        ALTER TABLE core.table_columns
            ADD CONSTRAINT fk_table_columns_table
            FOREIGN KEY (table_id) REFERENCES core.tables (table_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'table_columns->tables FK skipped — %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_table_columns_column') THEN
        ALTER TABLE core.table_columns
            ADD CONSTRAINT fk_table_columns_column
            FOREIGN KEY (column_id) REFERENCES core.columns (column_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'table_columns->columns FK skipped — %', SQLERRM;
END $$;
