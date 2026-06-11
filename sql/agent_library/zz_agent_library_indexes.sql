CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_library_catalog_id
    ON agent_library.catalog (catalog_id);

-- Unique index for rows with a tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_library_catalog_tenant
    ON agent_library.catalog (agent_id, tenant_id)
    WHERE tenant_id IS NOT NULL;

-- Unique index for global (tenant-less) rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_library_catalog_global
    ON agent_library.catalog (agent_id)
    WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_agent_library_catalog_agent_internal_id
    ON agent_library.catalog (agent_internal_id);
