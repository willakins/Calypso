CREATE TABLE IF NOT EXISTS github_slack_user_mappings (
  github_username TEXT PRIMARY KEY,
  slack_username TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_slack_user_mappings_slack_username
  ON github_slack_user_mappings (slack_username);
