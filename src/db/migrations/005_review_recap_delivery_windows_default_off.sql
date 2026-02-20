ALTER TABLE review_recap_config
  ALTER COLUMN send_on_weekends SET DEFAULT false;

ALTER TABLE review_recap_config
  ALTER COLUMN send_on_holidays SET DEFAULT false;

UPDATE review_recap_config
SET send_on_weekends = false
WHERE send_on_weekends = true;

UPDATE review_recap_config
SET send_on_holidays = false
WHERE send_on_holidays = true;
