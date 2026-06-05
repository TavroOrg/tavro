CREATE TABLE IF NOT EXISTS public.agent_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_attachment_agent_id_idx
ON public.agent_attachment (agent_id, created_at DESC);
