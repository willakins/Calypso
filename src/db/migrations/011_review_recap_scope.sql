ALTER TABLE review_recap_config
  ADD COLUMN IF NOT EXISTS review_scope TEXT NOT NULL DEFAULT 'all';

ALTER TABLE review_recap_config
  DROP CONSTRAINT IF EXISTS review_recap_config_scope_check;

ALTER TABLE review_recap_config
  ADD CONSTRAINT review_recap_config_scope_check
  CHECK (review_scope IN ('all', 'day', 'week', 'month', 'legacy'));
