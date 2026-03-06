CREATE TABLE IF NOT EXISTS environment_status_config (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  target_url TEXT,
  target_channel_id TEXT,
  last_observed_state TEXT NOT NULL DEFAULT 'unknown',
  last_state_changed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error_message TEXT,
  last_notified_state TEXT,
  last_notified_at TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT environment_status_config_singleton_check CHECK (id = 1),
  CONSTRAINT environment_status_config_observed_state_check
    CHECK (last_observed_state IN ('unknown', 'healthy', 'unhealthy')),
  CONSTRAINT environment_status_config_notified_state_check
    CHECK (last_notified_state IN ('healthy', 'unhealthy') OR last_notified_state IS NULL)
);

INSERT INTO environment_status_config (
  id,
  enabled,
  target_url,
  target_channel_id,
  last_observed_state,
  updated_by,
  updated_at
)
VALUES (
  1,
  false,
  NULL,
  NULL,
  'unknown',
  NULL,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_email_config (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  target_channel_id TEXT,
  on_call_user_id TEXT,
  on_call_expires_at TIMESTAMPTZ,
  last_processed_history_id NUMERIC(20, 0),
  pending_history_id NUMERIC(20, 0),
  watch_expiration_at TIMESTAMPTZ,
  backfill_completed_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_email_config_singleton_check CHECK (id = 1)
);

INSERT INTO support_email_config (
  id,
  enabled,
  target_channel_id,
  on_call_user_id,
  on_call_expires_at,
  last_processed_history_id,
  pending_history_id,
  watch_expiration_at,
  backfill_completed_at,
  last_sync_at,
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
  NULL,
  NULL,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_email_threads (
  id BIGSERIAL PRIMARY KEY,
  gmail_thread_id TEXT NOT NULL,
  gmail_first_message_id TEXT,
  subject TEXT,
  first_sender TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  first_received_at TIMESTAMPTZ NOT NULL,
  notification_sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  responded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_email_threads_gmail_thread_id_unique UNIQUE (gmail_thread_id),
  CONSTRAINT support_email_threads_status_check CHECK (status IN ('pending', 'responded'))
);

CREATE INDEX IF NOT EXISTS idx_support_email_threads_pending_first_received_at
  ON support_email_threads (status, first_received_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_support_email_threads_unsent_notifications
  ON support_email_threads (first_received_at ASC, id ASC)
  WHERE status = 'pending' AND notification_sent_at IS NULL;
