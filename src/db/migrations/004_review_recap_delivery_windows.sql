ALTER TABLE review_recap_config
  ADD COLUMN IF NOT EXISTS send_on_weekends BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE review_recap_config
  ADD COLUMN IF NOT EXISTS send_on_holidays BOOLEAN NOT NULL DEFAULT true;
