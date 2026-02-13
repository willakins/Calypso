CREATE TABLE IF NOT EXISTS deployment_whitelist (
  slack_user_id TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployment_whitelist_added_by
  ON deployment_whitelist (added_by);
