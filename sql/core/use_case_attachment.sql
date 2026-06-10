CREATE TABLE IF NOT EXISTS public.use_case_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    use_case_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS use_case_attachment_use_case_idx
ON public.use_case_attachment (use_case_id, created_at DESC);
