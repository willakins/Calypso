CREATE TABLE IF NOT EXISTS error_tracking_config (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  target_channel_id TEXT,
  project_slug TEXT,
  environment TEXT,
  baseline_completed_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT error_tracking_config_singleton_check CHECK (id = 1)
);

INSERT INTO error_tracking_config (
  id,
  enabled,
  target_channel_id,
  project_slug,
  environment,
  baseline_completed_at,
  last_sync_at,
  last_sync_error,
  updated_by,
  updated_at
)
VALUES (
  1,
  false,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS error_tracking_issues (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  environment_key TEXT NOT NULL DEFAULT '',
  external_issue_id TEXT NOT NULL,
  short_id TEXT,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT,
  permalink TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unresolved',
  opened_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  regression_count INTEGER NOT NULL DEFAULT 0,
  notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT error_tracking_issues_provider_check CHECK (provider IN ('sentry')),
  CONSTRAINT error_tracking_issues_status_check CHECK (status IN ('unresolved', 'resolved')),
  CONSTRAINT error_tracking_issues_regression_count_check CHECK (regression_count >= 0),
  CONSTRAINT error_tracking_issues_event_count_check CHECK (event_count >= 0),
  CONSTRAINT error_tracking_issues_scope_external_id_unique
    UNIQUE (provider, project_slug, environment_key, external_issue_id)
);

CREATE INDEX IF NOT EXISTS idx_error_tracking_issues_active_scope
  ON error_tracking_issues (provider, project_slug, environment_key, status, last_seen_at DESC, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_tracking_issues_unnotified
  ON error_tracking_issues (provider, project_slug, environment_key, last_seen_at DESC, opened_at DESC)
  WHERE status = 'unresolved' AND notification_sent_at IS NULL;
