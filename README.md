# Calypso

Calypso is a platform-abstracted deployment gatekeeper for a single repository workflow.
It currently runs with Slack + GitHub + DigitalOcean by default, while exposing provider
abstractions for communication, code-host, and deploy integrations.
It tracks merged pull requests in Postgres, requires explicit testing confirmation,
blocks production deploys when untested changes exist, and posts scheduled review recap messages.

## What It Does

- Ingests merged code-host pull requests into `pull_requests` as `untested`.
- Tracks open PR review lifecycle in `open_pr_review_state`.
- Reconciles open PR review state from code host once per day (when code-host API token is configured).
- Exposes a communication-platform command surface (`/calypso` for Slack).
- Supports status and release workflow commands:
  - `/calypso help`
  - `/calypso config time-format:human|long`
  - `/calypso config timezone:America/New_York`
  - `/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`
  - `/calypso config review-recap-recency:<Nd|Nw>`
  - `/calypso config review-recap-schedule:<weekday>@HH:MM`
  - `/calypso config review-recap-timezone:America/New_York`
  - `/calypso sync`
  - `/calypso status`
  - `/calypso reviews [<GITHUB_USER>] [<day|week|month>]`
  - `/calypso tested <PR_NUMBER>`
  - `/calypso deploy prod`
- Enforces deploy blocking rules:
  - A blocker is any PR with `merged_at > last_prod_deploy_at` and `status` not in `tested`, `deployed`.
- Optionally triggers deploy-platform production deploy when gate is clear.
- Runtime display config is per communication user (defaults: time format `human`, timezone `America/New_York`).
- Review recap schedule config is workspace-wide (defaults: Monday 9:00 AM `America/New_York`, recency `1w`).

## Architecture

Calypso is a single Node.js service composed of:

- Communication platform provider (Slack implemented; Microsoft Teams scaffolded).
- Code-host platform provider (GitHub implemented; Bitbucket scaffolded).
- Deploy platform provider (DigitalOcean implemented; AWS scaffolded).
- Express HTTP server for webhooks.
- Postgres persistence through `pg`.

Unimplemented providers intentionally fail fast at startup when selected.

### Command System Design

Commands are structured for extensibility:

- `registry`:
  - Command lookup and dispatch by command name.
- `types`:
  - One file per command type (`help`, `config`, `status`, `tested`, `deploy`, `unknown`).
  - Each command encapsulates its own parse + execute behavior.
- `base class`:
  - Shared command contract and helpers.

To add a new command:

1. Create a new command class in `src/commands/types/`.
2. Register it in `src/commands/registry/calypso_command_registry.js`.

## Project Layout

```text
src/
  app.js
  config.js
  commands/
    calypso.js
    parsing/
      calypso_command_parser.js
    registry/
      calypso_command_registry.js
    services/
      calypso_command_service.js
    types/
      base_calypso_command.js
      help_command.js
      config_command.js
      status_command.js
      tested_command.js
      deploy_command.js
      unknown_command.js
  db/
    index.js
    migrations/001_init.sql
  background_jobs/
    scheduler.js
    review_recap_scheduler.js
    syncer.js
    tasks/
      review_sync_task.js
      untested_merged_sync_task.js
  platform/
    shared/
      errors.js
    communication/
      base_communication_platform.js
      factory.js
      providers/
        slack_communication_platform.js
        microsoft_teams_communication_platform.js
    code_host/
      base_code_host_platform.js
      factory.js
      providers/
        github_code_host_platform.js
        bitbucket_code_host_platform.js
        github/
          client.js
          webhook.js
          verify_signature.js
    deploy/
      base_deploy_platform.js
      factory.js
      providers/
        digitalocean_deploy_platform.js
        aws_deploy_platform.js
        digitalocean/
          client.js
  util/
    format.js
test/
  *.test.js
```

## Prerequisites

- Node.js 18+ (Node 20 recommended).
- `ngrok` installed and authenticated.
- PostgreSQL CLI tools installed (`initdb`, `pg_ctl`, `psql`) for automated local stack start.
- A Slack app with:
  - Socket Mode enabled.
  - Slash command `/calypso`.
- Optional:
  - DigitalOcean App Platform app and token for live deploy trigger.

## Environment Variables

Always required:

- `DATABASE_URL`
- `COMMUNICATION_PROVIDER` (default: `slack`)
- `CODE_HOST_PROVIDER` (default: `github`)
- `DEPLOY_PROVIDER` (default: `digitalocean`)

Required when `COMMUNICATION_PROVIDER=slack`:

- `COMMUNICATION_BOT_TOKEN`
- `COMMUNICATION_APP_TOKEN`

Required when `CODE_HOST_PROVIDER=github`:

- `CODE_HOST_WEBHOOK_SECRET`
- `CODE_HOST_REPOSITORY` (example: `croft-eng/croft`)
- `CODE_HOST_MAIN_BRANCH` (example: `main`)

Optional:

- `PORT` (default `3000`)
- `DEPLOY_TOKEN`
- `DEPLOY_PROD_APP_ID`
- `DEPLOY_POLL_INTERVAL_SECONDS` (default `10`)
- `DEPLOY_TIMEOUT_SECONDS` (default `1200`)
- `CODE_HOST_TOKEN` (recommended for daily open-PR reconciliation)
- `CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (default `24`)

Provider support matrix:

- Communication:
  - `slack`: implemented
  - `microsoft_teams`: scaffold only (startup fail-fast)
- Code host:
  - `github`: implemented
  - `bitbucket`: scaffold only (startup fail-fast)
- Deploy:
  - `digitalocean`: implemented
  - `aws`: scaffold only (startup fail-fast)

### How To Get Each Value

`COMMUNICATION_PROVIDER`

- Provider selector for communication integration.
- Supported values: `slack` (implemented), `microsoft_teams` (startup fail-fast scaffold).
- Default: `slack`.

`CODE_HOST_PROVIDER`

- Provider selector for code-host integration.
- Supported values: `github` (implemented), `bitbucket` (startup fail-fast scaffold).
- Default: `github`.

`DEPLOY_PROVIDER`

- Provider selector for deploy integration.
- Supported values: `digitalocean` (implemented), `aws` (startup fail-fast scaffold).
- Default: `digitalocean`.

`COMMUNICATION_BOT_TOKEN`

- Slack App -> `OAuth & Permissions` -> install/reinstall app -> copy `Bot User OAuth Token` (`xoxb-...`).
- Add bot scope `users:read` so Calypso can detect workspace admins for deploy authorization.

`COMMUNICATION_APP_TOKEN`

- Slack App -> `Socket Mode` -> enable -> generate app-level token with `connections:write` scope -> copy token (`xapp-...`).

`DATABASE_URL`

- If using `npm run start` managed local runtime, use:
  - `postgresql://calypso_user@127.0.0.1:5433/postgres`
- If using your own Postgres, set your own host/port/user/db:
  - `postgresql://<user>:<password>@<host>:<port>/<database>`
- If using DigitalOcean Managed PostgreSQL, use the connection string from DO with:
  - `?sslmode=require` (Calypso enables TLS automatically when this is present)

`CODE_HOST_WEBHOOK_SECRET`

- Generate a random secret, for example:
  - `openssl rand -hex 32`
- Use the same value in `.env` and in GitHub repo webhook settings.

`CODE_HOST_REPOSITORY`

- Set to the exact full repo name:
  - `<owner>/<repo>` (example: `willakins/Test-repo`)
- Must exactly match `payload.repository.full_name` from GitHub webhook events.

`CODE_HOST_MAIN_BRANCH`

- Usually `main` (or your default protected branch, like `master`).
- Must match the base branch of merged PRs you want Calypso to track.

`CODE_HOST_TOKEN` (optional, enables daily PR reconciliation)

- GitHub -> Settings -> Developer settings -> Personal access tokens (fine-grained or classic).
- Minimum needed access for this repo: read pull requests.
- Used only for scheduled read-only sync of open PR and review state.

`CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (optional)

- How often Calypso reconciles open PR review state from GitHub API.
- Default: `24`.

`PORT` (optional)

- Local HTTP port for the webhook server and ngrok tunnel.
- Default is `3000`; only set this if you need a different port.

`DEPLOY_TOKEN` (optional unless using `/calypso deploy prod`)

- DigitalOcean -> `API` -> `Tokens/Keys` -> generate personal access token.
- Recommended custom scopes for this app-deploy flow:
  - `app:update` (plus required read dependencies auto-added by DO).

`DEPLOY_PROD_APP_ID` (optional unless using `/calypso deploy prod`)

- DigitalOcean App Platform app UUID.
- Find it with:
  - `doctl apps list --format ID,Spec.Name`
- Safe rollout: set this to a staging app first.

`DEPLOY_POLL_INTERVAL_SECONDS` (optional)

- Poll interval for checking deployment completion status after deploy trigger.
- Default: `10` seconds.

`DEPLOY_TIMEOUT_SECONDS` (optional)

- Max time Calypso waits for deployment completion follow-up message.
- Default: `1200` seconds (20 minutes).

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with required values.
3. Start the full local stack (temporary Postgres + ngrok + app):

```bash
npm run start
```

This command will:

- Initialize a temporary Postgres cluster at `.tmp/calypso-pg` (first run only).
- Start Postgres on port `5433`.
- Start ngrok on `PORT` (default `3000`).
- Start the Calypso app.
- Print the ngrok URL to use for code-host webhook configuration.

To stop everything and remove temporary DB/runtime files:

```bash
npm run stop
```

If you already run your own Postgres and tunnel manually, start only the app:

```bash
npm run dev
```

On app startup Calypso will:

- Verify DB connectivity (`SELECT 1`).
- Run migrations (`src/db/migrations/*.sql`) idempotently.
- Construct selected communication/code-host/deploy providers (fail-fast if selected provider is scaffold-only).
- Start webhook server on `PORT`.
- Start communication platform runtime (Socket Mode for Slack).

## Docker

Build image:

```bash
docker build -t calypso:local .
```

Run container:

```bash
docker run --rm -p 3000:3000 --env-file .env calypso:local
```

Notes:

- Container startup command is `node src/app.js` (not the local runtime script).
- For container hosting, set `DATABASE_URL` to a real reachable database (not `127.0.0.1` unless DB is inside same network namespace).
- Migrations still run automatically at startup.

## DigitalOcean Hosting

Recommended setup:

1. Create a Managed PostgreSQL cluster in DigitalOcean.
2. Copy the cluster connection string and set `DATABASE_URL` with `sslmode=require`.
3. Create an App Platform app from this repo using the `Dockerfile`.
4. Set all required env vars in App Platform:
   - `COMMUNICATION_PROVIDER=slack`
   - `CODE_HOST_PROVIDER=github`
   - `DEPLOY_PROVIDER=digitalocean`
   - `COMMUNICATION_BOT_TOKEN`
   - `COMMUNICATION_APP_TOKEN`
   - `DATABASE_URL`
   - `CODE_HOST_WEBHOOK_SECRET`
   - `CODE_HOST_REPOSITORY`
   - `CODE_HOST_MAIN_BRANCH`
5. Optional deploy vars:
   - `DEPLOY_TOKEN`
   - `DEPLOY_PROD_APP_ID`

Operational notes:

- Use a stable public app URL for webhook target:
  - `https://<your-app-domain>/github/webhook` (legacy-compatible path)
  - `https://<your-app-domain>/codehost/webhook` (provider-neutral alias)
- Slack Socket Mode does not require a public ingress for slash commands.
- Keep one running Calypso instance for consistent webhook ingestion.

## DigitalOcean Deployment Runbook

Use this when deploying Calypso as an always-on service in DigitalOcean App Platform.

### 1. Create/prepare managed Postgres

1. Create a DigitalOcean Managed PostgreSQL cluster in the same region as your app.
2. Create a dedicated database user for Calypso (recommended).
3. Copy the connection string and keep `sslmode=require` in the URL.
4. Set this value as `DATABASE_URL` in App Platform.

### 2. Create the App Platform app from this repo

1. In DigitalOcean, create a new App Platform app from your GitHub repo.
2. Choose Dockerfile-based deploy using the repo root `Dockerfile`.
3. Configure service type as Web Service.
4. Set HTTP port to `3000` (or rely on `PORT` env if configured by the platform).
5. Set instance count to `1` for v1 to keep webhook/command processing single-instance.

### 3. Configure App Platform environment variables

Set these as encrypted environment variables in App Platform:

- `COMMUNICATION_PROVIDER=slack`
- `CODE_HOST_PROVIDER=github`
- `DEPLOY_PROVIDER=digitalocean`
- `COMMUNICATION_BOT_TOKEN`
- `COMMUNICATION_APP_TOKEN`
- `DATABASE_URL` (with `sslmode=require`)
- `CODE_HOST_WEBHOOK_SECRET`
- `CODE_HOST_REPOSITORY`
- `CODE_HOST_MAIN_BRANCH`

Optional:

- `DEPLOY_TOKEN`
- `DEPLOY_PROD_APP_ID`

### 4. Configure health checks

Calypso exposes `GET /healthz` for platform health checks. In App Platform:

1. Use HTTP health check path: `/healthz`
2. Keep expected status in the `2xx` range

### 5. Wire code-host webhook to the hosted app

1. After first successful deploy, copy the app URL (for example `https://calypso-xxxx.ondigitalocean.app`).
2. In your GitHub repo webhook settings:
   - Payload URL: `https://<your-app-domain>/codehost/webhook` (or `/github/webhook`)
   - Content type: `application/json`
   - Secret: same value as `CODE_HOST_WEBHOOK_SECRET`
   - Events: `Pull requests`
3. Trigger a test merge to `CODE_HOST_MAIN_BRANCH`.
4. Confirm webhook delivery is `200` in GitHub and row is created/updated in `pull_requests`.

### 6. Smoke test in Slack

Run these commands in your Slack workspace:

1. `/calypso help`
2. `/calypso status`
3. `/calypso tested <PR_NUMBER>` (for a merged untested PR)
4. `/calypso deploy prod` (if DO deploy vars are set)

Expected:

- Help/status/tested respond ephemerally.
- Deploy is blocked when untested PRs exist.
- Deploy triggers only when gate is clear and DO deploy vars are configured.

### 7. Cutover notes

- Stop relying on local/ngrok webhook delivery once hosted webhook is active.
- Keep only one primary always-on Calypso instance.
- Rotate secrets after deployment if they were ever exposed in logs/chat.

## Code-Host Webhook

Endpoint:

- `POST /github/webhook` (backward-compatible)
- `POST /codehost/webhook` (provider-neutral alias)

Rules:

- Requires valid `X-Hub-Signature-256` HMAC signature.
- Processes `pull_request` and `pull_request_review` events.
- Only processes events for configured `CODE_HOST_MAIN_BRANCH` and configured `CODE_HOST_REPOSITORY`.
- Merged PR close events upsert to deploy-gating table as `untested`.
- Open PR lifecycle and review submissions update `open_pr_review_state`.

## Daily Open PR Sync

- Runs as a background scheduler in the app runtime.
- Performs a full open-PR reconciliation for `CODE_HOST_REPOSITORY` + `CODE_HOST_MAIN_BRANCH`.
- Frequency is controlled by `CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (default every 24 hours).
- Requires `CODE_HOST_TOKEN`; without it, webhook-based tracking still works but no periodic backfill runs.
- Upserts all currently open PR review-state rows and marks stale local open rows as `closed`.
- Backfills merged PRs newer than last prod deploy into deploy-gating state as `untested` (without downgrading already `tested`/`deployed` rows).

## Slash Command Behavior

`/calypso help`

- Returns usage.

`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`

- Sets workspace recap target channel for scheduled in-channel posts.

`/calypso config review-recap-recency:<Nd|Nw>`

- Sets recap lookback window (for example `1w`, `2w`, `2d`).

`/calypso config review-recap-schedule:<weekday>@HH:MM`

- Sets weekly send slot using weekday + 24h clock (for example `mon@09:00`, `tue@10:15`).

`/calypso config review-recap-timezone:America/New_York`

- Sets recap schedule timezone (IANA timezone).

`/calypso sync`

- Triggers open PR reconciliation immediately using GitHub API.
- Requires workspace admin or Calypso deploy-whitelist access.
- Returns counts for both sync paths:
  - review-state sync (open PRs upserted + stale open rows closed)
  - merged-untested sync (merged PRs backfilled as untested)

`/calypso status`

- Shows blockers since last production deployment.
- If no deployments exist, baseline is epoch (`1970-01-01T00:00:00.000Z`).

`/calypso reviews [<GITHUB_USER>] [<day|week|month>]`

- Lists open PRs waiting on review from review-tracking state.
- Optional GitHub user filter (author login).
- Optional recency filter (`day`, `week`, `month`).
- Supports `recent` keyword variant: `/calypso reviews recent <day|week|month>`.

`/calypso tested <PR_NUMBER>`

- Marks the PR as tested.
- Idempotent when already tested.
- Returns clear message if PR not found.

`/calypso tested all`

- Marks all currently `untested` PRs as `tested`.

`/calypso tested recent <day|week|month>`

- Lists PRs tested in the selected recent timeframe.
- Includes PR number, repo, status, tester, and tested timestamp.

`/calypso whitelist <@USER>`

- Restricted command for workspace admins or already-whitelisted users.
- Adds a user to Calypso deploy whitelist.
- Whitelisted users can run deploy commands even if they are not workspace admins.

`/calypso deploy prod`

- Blocks when untested blockers exist.
- Access restricted to workspace admins and whitelisted users.
- If no blockers and DigitalOcean env vars missing, returns "deploy not configured".
- If configured and deploy succeeds:
  - inserts a `deployments` row
  - marks tested PRs since last deploy as `deployed`
- If deploy fails:
  - does not write deployment row
  - does not mark PRs deployed
- After trigger, Calypso sends a follow-up message when DigitalOcean finishes the deployment.

`/calypso deploy prod force` (or `/calypso deploy prod forced`)

- Bypasses blocker checks and triggers deploy anyway.
- Still requires deploy configuration (`DEPLOY_TOKEN`, `DEPLOY_PROD_APP_ID`).

## Weekly Review Recap

- Runs as a background scheduler in the app runtime.
- Checks once per minute for configured recap slot.
- Posts in-channel message in configured `review-recap-channel` containing:
  - Header: `Pull Requests waiting on review in the last {recency}`
  - PR rows with title, author login, and `opened for review` timestamp.
- Includes empty state (`• None`) when no PRs match.
- PR matching rule:
  - `lifecycle_state = open`
  - `is_draft = false`
  - `review_state in (waiting, changes_requested)`
  - `opened_for_review_at` within configured recency.

## Testing

Run full test suite:

```bash
npm test
```

Current tests cover:

- Command parsing and routing.
- High-level command lifecycle flow.
- Config validation behavior.
- GitHub signature verification and webhook decision gates.
- DigitalOcean client request/response handling.
- Formatting behavior.

### Enforce PR Test Passes Before Merge

This repo includes GitHub Actions workflow `CI` (`.github/workflows/ci.yml`) that runs `npm test` on every PR to `main`.

To block merges when tests fail, enable branch protection on `main`:

1. GitHub repo -> `Settings` -> `Branches` -> add/edit protection rule for `main`.
2. Enable `Require status checks to pass before merging`.
3. Select required check: `CI / test`.
4. Save the rule.

## Local Validation Tips

- Offline-first validation is supported.
- Live smoke tests are optional and useful for final confidence:
  - Slack `/calypso ...` command flow in a real workspace.
  - GitHub webhook through ngrok/cloudflared.
  - Real DigitalOcean deploy trigger with test-safe app config.

## Security Notes

- Never commit `.env` or secrets.
- If secrets are exposed, rotate immediately.
- Keep `CODE_HOST_WEBHOOK_SECRET` and API tokens scoped and rotated periodically.
