CREATE TABLE IF NOT EXISTS public.application_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_attachment_application_id_idx
ON public.application_attachment (application_id, created_at DESC);
