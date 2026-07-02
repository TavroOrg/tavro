CREATE TABLE IF NOT EXISTS public.integration_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_attachment_integration_id_idx
ON public.integration_attachment (integration_id, created_at DESC);
