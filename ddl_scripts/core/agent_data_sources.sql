CREATE TABLE IF NOT EXISTS core.agent_data_sources (
	tenant_id TEXT,
	agent_id TEXT,
    access_level TEXT,
    contains_pii boolean,
    contains_phi boolean,
    contains_pci boolean,
    created_ts timestamp,
    updated_ts timestamp,
    relationship_id TEXT,
    parent_relationship_id TEXT,
    source_object_id TEXT,
    source_object_domain TEXT,
    source_object_name TEXT,
    source_object_type TEXT,
    target_object_id TEXT,
    target_object_domain TEXT,
    target_object_name TEXT,
    target_object_type TEXT,
    agent_internal_id TEXT
);

