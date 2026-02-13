CREATE TABLE IF NOT EXISTS runtime_user_config (
  slack_user_id TEXT PRIMARY KEY,
  time_format TEXT NOT NULL DEFAULT 'human',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runtime_user_config_time_format_check CHECK (time_format IN ('human', 'long'))
);
