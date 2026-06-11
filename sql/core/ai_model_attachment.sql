CREATE TABLE IF NOT EXISTS public.ai_model_attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_model_id TEXT NOT NULL,
    category TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INT NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_model_attachment_model_idx
ON public.ai_model_attachment (ai_model_id, category, created_at DESC);
