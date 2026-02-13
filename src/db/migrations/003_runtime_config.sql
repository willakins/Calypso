CREATE TABLE IF NOT EXISTS runtime_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  time_format TEXT NOT NULL DEFAULT 'human',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runtime_config_singleton_check CHECK (id = 1),
  CONSTRAINT runtime_config_time_format_check CHECK (time_format IN ('human', 'long'))
);

INSERT INTO runtime_config (id, time_format, updated_by, updated_at)
VALUES (1, 'human', 'system', NOW())
ON CONFLICT (id) DO NOTHING;
