-- NULL = not extracted (historical/in-flight analyses); [] = extracted with no signals.
ALTER TABLE public.conversation_analysis
    ADD COLUMN IF NOT EXISTS pattern_signals jsonb DEFAULT NULL
    CHECK (pattern_signals IS NULL OR jsonb_typeof(pattern_signals) = 'array');
