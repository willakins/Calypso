ALTER TABLE open_pr_review_state
  ADD COLUMN IF NOT EXISTS codex_approved BOOLEAN NOT NULL DEFAULT false;
