CREATE TABLE IF NOT EXISTS raw.run_time_logs (
	tenant_id TEXT,
    tool_name TEXT,    
    arguments TEXT,
    created_ts timestamp	
);
