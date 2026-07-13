# Database Modernization — Task List

## Critical

### 1. Add tenant_id to tables
Since tenant_id is owned by Zitadel and just *fetched* into the app, this is not "create a tenant table in Postgres" — it's "make sure every row that should have a tenant_id actually has one, and that it matches what Zitadel issued." Concretely: backfill NULLs on the tables currently missing it or where it's optional, add `NOT NULL`, and add a `CHECK` constraint on format (e.g., matches Zitadel's org ID shape) as a cheap sanity guard since you can't FK to an external identity provider. Run `check_null_tenant_across_db.sql` first — it already tells you exactly which tables and how many rows are affected today.

### 2. Add composite primary keys to tables using tenant_id, company_id and respective asset id
Bakes tenant/company scoping directly into the key that every join and every RLS policy will use, rather than relying on a separate unscoped surrogate key. Apply this pattern to `agents`, `business_applications`, `business_processes`, `business_integrations`, `ai_models`, `ai_use_cases`, `tools`, `skills`, `issues`, `spark_ideas` — the "direct owner" tables. For child/junction tables (`agent_configurations`, `agent_tools`, etc.) the natural composite is `(agent_internal_id, <catalog>_id)` since tenant/company is inherited from the parent, not stored independently there.

### 3. Agent catalog loading is slow — sequential pagination
Frontend fetches pages sequentially, creating long wait times and poor responsiveness. This is compounded by missing indexes (#6 below) — without indexes on the filter columns the pagination queries walk against, even a fixed pagination strategy will stay slow. Treat the frontend fix and the index fix as a paired critical item.

### 4. Missing database indexes
None of the `core`/`curated`/`raw`/`risk_management` tables have any index beyond the unique indexes needed for dedup. Every tenant/company-filtered list view — which is every list view in a multi-tenant UI — is currently a full sequential scan. Minimum viable fix: composite index on `(company_id, tenant_id)` on every direct-owner table, plus `agent_id` indexes on every `agent_*` child table (Postgres does not auto-index the referencing side of a foreign key, so this has to be explicit even after FKs are added).

### 5. [DONE] Make the per-version identity the source of agent_id
`core.agents` used to carry two identifiers: `agent_id` (stable business identity) and `agent_internal_id` (per-version identity under the SCD Type 2 versioning pattern — `is_current`, `valid_from_ts`/`valid_to_ts`). Every child/junction table already keyed off `agent_internal_id`, not `agent_id`, so `agent_internal_id` was *already* the de facto identity in practice. This has been made official: `agent_internal_id` is renamed to `agent_id` everywhere (the real composite primary/foreign key column), and the old business-key `agent_id` is renamed to `agent_source_id` — an optional, nullable attribute populated only for agents ingested via a connector; platform-created agents leave it NULL. See `audit_db/04_rename_agent_id_and_agent_source_id.sql` for the production migration.

### 6. change attachment tables schema to core
`public.agent_attachment`, `ai_model_attachment`, `application_attachment`, etc. have **no tenant_id or company_id column at all**, and no foreign key to their parent entity. They're isolated only by the assumption that `agent_id`/`application_id` strings are globally unique across tenants. If that assumption is wrong anywhere in the ingestion pipeline, uploaded files could already be visible across tenants today. This needs a same-week verification pass independent of everything else on this list — it's the one item that could be an active issue rather than a future risk.

---

## High

### 1. Use UUID as data type instead of text for ID
Applies broadly, but `company_id` is the highest-value case: `core.company_id` (TEXT) is already confirmed to just be the text form of `twin.company.id` (UUID) — the two schemas independently invented different representations of the same identity. Converting closes that gap and lets you finally add a real FK from `core` into the `twin` company registry. Do this with the "add new UUID column, dual-write, backfill, swap, drop old column" pattern rather than an in-place type change — an in-place `ALTER COLUMN TYPE UUID` rewrites every row and can lock large tables for the duration.

### 2. Add foreign keys across the agent/catalog/junction graph
Right now only 5 FKs exist in the entire `core` schema (all added retroactively in `sql/core/zz_agent_upsert_unique_indexes.sql`). ~30 more relationships are implied by naming and join patterns but unenforced — every `agent_*` detail table to `agents`, every junction table to both sides of its relationship, `agent_risk_scenarios` to `agent_risk_assessment`, and the attachment tables to their parent entities. This is what turns "orphaned rows are theoretically possible" into "orphaned rows are impossible," and it's a prerequisite for partitioning and for clean cascading deletes. Use `ADD CONSTRAINT ... NOT VALID` + a separate `VALIDATE CONSTRAINT` pass so this doesn't require downtime on large tables.

### 3. Enable Row-Level Security keyed on the Zitadel tenant claim
This is the direct enforcement mechanism for tenant isolation. Since tenant_id comes from Zitadel, the app already validates a Zitadel token per request — the RLS session variable (`SET app.current_tenant = ...`) should be set from that token's tenant claim at the top of each request/transaction, no local tenant table lookup needed. `twin` already has RLS *enabled* on 4 tables but with **zero policies defined**, so this is partly "finish something already started" and partly "extend it to `core`/`curated`/`risk_management`." Roll out with a single low-traffic tenant as a canary before enabling broadly — a misconfigured policy either leaks data or blocks legitimate reads.

### 4. Database queries are inefficient — pagination queries scan entire datasets
Missing indexes (Critical #4) mean even a corrected pagination query will still scan more data than necessary until indexes land — sequence the index work before or alongside this fix.

### 5. No caching strategy exists
Repeated reads hit the database instead of serving cached responses.

---

## Medium

### 1. Standardize timestamps to timestamptz
Every `core`/`risk_management`/`raw` table uses bare `timestamp` (no timezone); `twin` correctly uses `TIMESTAMPTZ` everywhere. Bare `timestamp` silently assumes server-local time and will produce wrong results the moment the app server, database, or any client is in a different timezone, or during a daylight-saving transition. This is a mechanical `ALTER COLUMN ... TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC'` per column (confirm the assumed stored timezone with the team first).

### 2. Partition tables by date
Two candidates: `core.agents` (SCD Type 2 — every historical version is retained forever with no purge/partition strategy) and the `raw.*` ingestion logs (`ingestion_log`, `run_time_logs`, `agent_card_json` — append-only, time-ordered). `twin.context_log` already demonstrates the pattern to replicate (`PARTITION BY RANGE (created_at)`, quarterly partitions). Sequence after adding surrogate PKs to the `raw.*` tables since a partitioned table's PK must include the partition key.

### 3. Add NOT NULL and default constraints
Beyond tenant_id (Critical #1), `agent_internal_id`/`agent_id` on every agent-child table and `created_ts`/`updated_ts` (with `DEFAULT now()`) across `core` and `risk_management` are currently nullable with no default. Cheap to add via the Postgres 12+ trick of validating a `CHECK (col IS NOT NULL) NOT VALID` first so the final `SET NOT NULL` is metadata-only.

### 4. HTTP connections are not reused
New clients are created repeatedly, increasing connection overhead.

### 5. Authentication adds unnecessary latency
Token validation occurs too frequently and increases request cost.

### 6. Session storage is overloaded
Large cached datasets impact browser performance and scalability.

### 7. API responses are not cache optimized
Missing HTTP caching causes avoidable network traffic.

### 8. Current architecture does not scale reliably
Performance degrades significantly beyond ~100 concurrent users.

### 9. Resolve tools/skills catalog scoping (global vs per-tenant)
`core.tools.tool_id` and `core.skills.skill_id` have globally-unique indexes with no `tenant_id` in the key, even though both tables carry a `tenant_id` column — ambiguous whether these are meant to be a shared library across tenants or accidentally under-scoped. This is a product decision, not an engineering one, but it blocks finalizing the FK design for every `agent_tools`/`agent_skills`-style junction table, so it should be answered before Critical #4 (indexes) and High #2 (FKs) are finalized for those specific tables.
