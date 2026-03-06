ALTER TABLE runtime_config
  ADD COLUMN IF NOT EXISTS email_provider TEXT NOT NULL DEFAULT 'gmail',
  ADD COLUMN IF NOT EXISTS error_tracking_provider TEXT NOT NULL DEFAULT 'sentry';

UPDATE runtime_config
SET email_provider = COALESCE(NULLIF(TRIM(email_provider), ''), 'gmail'),
    error_tracking_provider = COALESCE(NULLIF(TRIM(error_tracking_provider), ''), 'sentry')
WHERE id = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runtime_config_email_provider_check'
  ) THEN
    ALTER TABLE runtime_config
      ADD CONSTRAINT runtime_config_email_provider_check
      CHECK (email_provider IN ('gmail', 'outlook'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runtime_config_error_tracking_provider_check'
  ) THEN
    ALTER TABLE runtime_config
      ADD CONSTRAINT runtime_config_error_tracking_provider_check
      CHECK (error_tracking_provider IN ('sentry', 'rollbar'));
  END IF;
END
$$;
