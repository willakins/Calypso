ALTER TABLE pull_requests
  ADD COLUMN IF NOT EXISTS force_deploy_blocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pull_requests_force_deploy_blocked
  ON pull_requests (force_deploy_blocked)
  WHERE force_deploy_blocked = TRUE;
