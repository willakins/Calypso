CREATE TABLE IF NOT EXISTS pull_requests (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'untested',
  merged_at TIMESTAMPTZ NOT NULL,
  tested_at TIMESTAMPTZ,
  tested_by TEXT,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pull_requests_repo_pr_number_unique UNIQUE (repo, pr_number),
  CONSTRAINT pull_requests_status_check CHECK (status IN ('untested', 'tested', 'deployed'))
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests (status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_merged_at ON pull_requests (merged_at);

CREATE TABLE IF NOT EXISTS deployments (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL DEFAULT 'prod',
  provider TEXT NOT NULL DEFAULT 'digitalocean',
  external_deploy_id TEXT,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployments_environment_deployed_at
  ON deployments (environment, deployed_at DESC);
