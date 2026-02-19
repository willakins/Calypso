ALTER TABLE review_recap_config
  DROP CONSTRAINT IF EXISTS review_recap_config_schedule_weekday_check;

ALTER TABLE review_recap_config
  ADD CONSTRAINT review_recap_config_schedule_weekday_check
  CHECK (schedule_weekday IN ('daily', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'));
