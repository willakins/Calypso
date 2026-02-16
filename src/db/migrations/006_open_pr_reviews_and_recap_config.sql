CREATE TABLE IF NOT EXISTS open_pr_review_state (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  author_login TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  lifecycle_state TEXT NOT NULL,
  review_state TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  opened_for_review_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  merged_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT open_pr_review_state_repo_pr_number_unique UNIQUE (repo, pr_number),
  CONSTRAINT open_pr_review_state_lifecycle_state_check
    CHECK (lifecycle_state IN ('open', 'closed', 'merged')),
  CONSTRAINT open_pr_review_state_review_state_check
    CHECK (review_state IN ('waiting', 'approved', 'changes_requested'))
);

CREATE INDEX IF NOT EXISTS idx_open_pr_review_state_waiting
  ON open_pr_review_state (lifecycle_state, review_state, is_draft, opened_for_review_at DESC);

CREATE TABLE IF NOT EXISTS review_recap_config (
  id INTEGER PRIMARY KEY,
  target_channel_id TEXT,
  recency_value INTEGER NOT NULL DEFAULT 1,
  recency_unit TEXT NOT NULL DEFAULT 'w',
  schedule_weekday TEXT NOT NULL DEFAULT 'mon',
  schedule_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  last_sent_slot_at TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT review_recap_config_singleton_check CHECK (id = 1),
  CONSTRAINT review_recap_config_recency_value_check CHECK (recency_value > 0),
  CONSTRAINT review_recap_config_recency_unit_check CHECK (recency_unit IN ('d', 'w')),
  CONSTRAINT review_recap_config_schedule_weekday_check
    CHECK (schedule_weekday IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'))
);

INSERT INTO review_recap_config (
  id,
  target_channel_id,
  recency_value,
  recency_unit,
  schedule_weekday,
  schedule_time,
  timezone,
  updated_by,
  updated_at
)
VALUES (1, NULL, 1, 'w', 'mon', '09:00', 'America/New_York', NULL, NOW())
ON CONFLICT (id)
DO NOTHING;
