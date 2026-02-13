# Calypso

Calypso is a Slack-based deployment gatekeeper for a single GitHub repository.
It tracks merged pull requests in Postgres, requires explicit testing confirmation,
and blocks production deploys when untested changes exist.

## What It Does

- Ingests merged GitHub pull requests into `pull_requests` as `untested`.
- Exposes a Slack slash command: `/calypso`.
- Supports status and release workflow commands:
  - `/calypso help`
  - `/calypso status`
  - `/calypso tested <PR_NUMBER>`
  - `/calypso deploy prod`
- Enforces deploy blocking rules:
  - A blocker is any PR with `merged_at > last_prod_deploy_at` and `status` not in `tested`, `deployed`.
- Optionally triggers DigitalOcean App Platform deploy when gate is clear.

## Architecture

Calypso is a single Node.js service composed of:

- Slack Bolt app (Socket Mode) for `/calypso` commands.
- Express HTTP server for `POST /github/webhook`.
- Postgres persistence through `pg`.
- Optional DigitalOcean deploy integration.

### Command System Design

Commands are structured for extensibility:

- `registry`:
  - Command lookup and dispatch by command name.
- `types`:
  - One file per command type (`help`, `status`, `tested`, `deploy`, `unknown`).
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
      status_command.js
      tested_command.js
      deploy_command.js
      unknown_command.js
  db/
    index.js
    migrations/001_init.sql
  integrations/
    github/
      webhook.js
      verify_signature.js
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

Required:

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `DATABASE_URL`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_REPO` (example: `croft-eng/croft`)
- `GITHUB_MAIN_BRANCH` (example: `main`)

Optional:

- `PORT` (default `3000`)
- `DIGITALOCEAN_TOKEN`
- `DO_APP_ID_PROD`
- `DO_DEPLOY_POLL_INTERVAL_SECONDS` (default `10`)
- `DO_DEPLOY_TIMEOUT_SECONDS` (default `1200`)
- `DEPLOY_CHANNEL_ID` (reserved for future use)

### How To Get Each Value

`SLACK_BOT_TOKEN`

- Slack App -> `OAuth & Permissions` -> install/reinstall app -> copy `Bot User OAuth Token` (`xoxb-...`).

`SLACK_APP_TOKEN`

- Slack App -> `Socket Mode` -> enable -> generate app-level token with `connections:write` scope -> copy token (`xapp-...`).

`DATABASE_URL`

- If using `npm run start` managed local runtime, use:
  - `postgresql://calypso_user@127.0.0.1:5433/postgres`
- If using your own Postgres, set your own host/port/user/db:
  - `postgresql://<user>:<password>@<host>:<port>/<database>`
- If using DigitalOcean Managed PostgreSQL, use the connection string from DO with:
  - `?sslmode=require` (Calypso enables TLS automatically when this is present)

`GITHUB_WEBHOOK_SECRET`

- Generate a random secret, for example:
  - `openssl rand -hex 32`
- Use the same value in `.env` and in GitHub repo webhook settings.

`GITHUB_REPO`

- Set to the exact full repo name:
  - `<owner>/<repo>` (example: `willakins/Test-repo`)
- Must exactly match `payload.repository.full_name` from GitHub webhook events.

`GITHUB_MAIN_BRANCH`

- Usually `main` (or your default protected branch, like `master`).
- Must match the base branch of merged PRs you want Calypso to track.

`PORT` (optional)

- Local HTTP port for the webhook server and ngrok tunnel.
- Default is `3000`; only set this if you need a different port.

`DIGITALOCEAN_TOKEN` (optional unless using `/calypso deploy prod`)

- DigitalOcean -> `API` -> `Tokens/Keys` -> generate personal access token.
- Recommended custom scopes for this app-deploy flow:
  - `app:update` (plus required read dependencies auto-added by DO).

`DO_APP_ID_PROD` (optional unless using `/calypso deploy prod`)

- DigitalOcean App Platform app UUID.
- Find it with:
  - `doctl apps list --format ID,Spec.Name`
- Safe rollout: set this to a staging app first.

`DO_DEPLOY_POLL_INTERVAL_SECONDS` (optional)

- Poll interval for checking deployment completion status after deploy trigger.
- Default: `10` seconds.

`DO_DEPLOY_TIMEOUT_SECONDS` (optional)

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
- Print the ngrok URL to use for GitHub webhook configuration.

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
- Run migrations (`001_init.sql`) idempotently.
- Start webhook server on `PORT`.
- Start Slack Socket Mode.

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
   - `SLACK_BOT_TOKEN`
   - `SLACK_APP_TOKEN`
   - `DATABASE_URL`
   - `GITHUB_WEBHOOK_SECRET`
   - `GITHUB_REPO`
   - `GITHUB_MAIN_BRANCH`
5. Optional deploy vars:
   - `DIGITALOCEAN_TOKEN`
   - `DO_APP_ID_PROD`

Operational notes:

- Use a stable public app URL for GitHub webhook target:
  - `https://<your-app-domain>/github/webhook`
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

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `DATABASE_URL` (with `sslmode=require`)
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_REPO`
- `GITHUB_MAIN_BRANCH`

Optional:

- `DIGITALOCEAN_TOKEN`
- `DO_APP_ID_PROD`

### 4. Configure health checks

Calypso exposes `GET /healthz` for platform health checks. In App Platform:

1. Use HTTP health check path: `/healthz`
2. Keep expected status in the `2xx` range

### 5. Wire GitHub webhook to the hosted app

1. After first successful deploy, copy the app URL (for example `https://calypso-xxxx.ondigitalocean.app`).
2. In your GitHub repo webhook settings:
   - Payload URL: `https://<your-app-domain>/github/webhook`
   - Content type: `application/json`
   - Secret: same value as `GITHUB_WEBHOOK_SECRET`
   - Events: `Pull requests`
3. Trigger a test merge to `GITHUB_MAIN_BRANCH`.
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

## GitHub Webhook

Endpoint:

- `POST /github/webhook`

Rules:

- Requires valid `X-Hub-Signature-256` HMAC signature.
- Only processes `pull_request` events.
- Only stores merged PRs to configured `GITHUB_MAIN_BRANCH` for configured `GITHUB_REPO`.
- On success upserts PR as `untested`.

## Slash Command Behavior

`/calypso help`

- Returns usage.

`/calypso status`

- Shows blockers since last production deployment.
- If no deployments exist, baseline is epoch (`1970-01-01T00:00:00.000Z`).

`/calypso tested <PR_NUMBER>`

- Marks the PR as tested.
- Idempotent when already tested.
- Returns clear message if PR not found.

`/calypso tested all`

- Marks all currently `untested` PRs as `tested`.

`/calypso tested recent <day|week|month>`

- Lists PRs tested in the selected recent timeframe.
- Includes PR number, repo, status, tester, and tested timestamp.

`/calypso deploy prod`

- Blocks when untested blockers exist.
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
- Still requires deploy configuration (`DIGITALOCEAN_TOKEN`, `DO_APP_ID_PROD`).

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
- Keep `GITHUB_WEBHOOK_SECRET` and API tokens scoped and rotated periodically.
