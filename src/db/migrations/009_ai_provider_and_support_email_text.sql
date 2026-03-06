ALTER TABLE runtime_config
  ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'openai';

UPDATE runtime_config
SET ai_provider = COALESCE(NULLIF(TRIM(ai_provider), ''), 'openai')
WHERE id = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runtime_config_ai_provider_check'
  ) THEN
    ALTER TABLE runtime_config
      ADD CONSTRAINT runtime_config_ai_provider_check
      CHECK (ai_provider IN ('openai', 'anthropic'));
  END IF;
END
$$;

ALTER TABLE support_email_threads
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS first_message_text TEXT;

UPDATE support_email_threads
SET source_provider = NULLIF(TRIM(source_provider), '')
WHERE source_provider IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'support_email_threads_source_provider_check'
  ) THEN
    ALTER TABLE support_email_threads
      ADD CONSTRAINT support_email_threads_source_provider_check
      CHECK (source_provider IN ('gmail', 'outlook') OR source_provider IS NULL);
  END IF;
END
$$;
