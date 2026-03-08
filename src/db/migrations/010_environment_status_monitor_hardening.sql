ALTER TABLE environment_status_config
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_connectivity_state TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_connectivity_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_connectivity_error_message TEXT;

UPDATE environment_status_config
SET consecutive_failure_count = 0
WHERE consecutive_failure_count IS NULL;

UPDATE environment_status_config
SET last_connectivity_state = COALESCE(NULLIF(TRIM(last_connectivity_state), ''), 'unknown')
WHERE id = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'environment_status_config_connectivity_state_check'
  ) THEN
    ALTER TABLE environment_status_config
      ADD CONSTRAINT environment_status_config_connectivity_state_check
      CHECK (last_connectivity_state IN ('unknown', 'reachable', 'unreachable'));
  END IF;
END
$$;
