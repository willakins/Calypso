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
  - `/calypso config communication-provider:slack|microsoft_teams`
  - `/calypso config code-host-provider:github|bitbucket`
  - `/calypso config deploy-provider:digitalocean|aws`
  - `/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`
  - `/calypso config review-recap-recency:<Nd|Nw>`
  - `/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`
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

- Communication platform provider (Slack implemented; Microsoft Teams implemented).
- Code-host platform provider (GitHub implemented; Bitbucket implemented).
- Deploy platform provider (DigitalOcean implemented; AWS CodePipeline implemented).
- Express HTTP server for webhooks.
- Postgres persistence through `pg`.

Unknown providers fail fast at startup.

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
2. Register it in `src/commands/registry/command_registry.js`.

## Project Layout

```text
src/
  app.js
  config.js
  commands/
    command_router.js
    parsing/
      command_parser.js
    registry/
      command_registry.js
    services/
      command_service.js
    types/
      base_command.js
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
        github/
          code_host_platform.js
          client.js
          webhook.js
          verify_signature.js
        bitbucket/
          code_host_platform.js
          client.js
          webhook.js
          verify_signature.js
    deploy/
      base_deploy_platform.js
      factory.js
      providers/
        digitalocean_deploy_platform.js
        aws_deploy_platform.js
        aws/
          client.js
        digitalocean/
          client.js
  util/
    format.js
test/
  *.test.js
```

## Prerequisites

- Node.js 18+ (Node 20 recommended).
- For local hosting only:
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
- `BOT_NAME` (default: `Calypso`)
- `COMMUNICATION_PROVIDER` (default: `slack`)
- `CODE_HOST_PROVIDER` (default: `github`)
- `DEPLOY_PROVIDER` (default: `digitalocean`)

Required when `COMMUNICATION_PROVIDER=slack`:

- `COMMUNICATION_BOT_TOKEN`
- `COMMUNICATION_APP_TOKEN`

Required when `CODE_HOST_PROVIDER=github` or `CODE_HOST_PROVIDER=bitbucket`:

- `CODE_HOST_WEBHOOK_SECRET`
- `CODE_HOST_REPOSITORY` (example: `croft-eng/croft`)
- `CODE_HOST_MAIN_BRANCH` (example: `main`)

Optional:

- `PORT` (default `3000`)
- `POSTGRES_PASSWORD` (required when using `docker-compose.droplet.yml`)
- `CADDY_EMAIL` (used by `Caddyfile.droplet` for TLS contact email)
- `DEPLOY_TOKEN`
- `DEPLOY_PROD_APP_ID`
- `DEPLOY_POLL_INTERVAL_SECONDS` (default `10`)
- `DEPLOY_TIMEOUT_SECONDS` (default `1200`)
- `CODE_HOST_TOKEN` (recommended for daily open-PR reconciliation)
- `CODE_HOST_CODEX_USER_LOGINS` (default: `codex,codex[bot]`)
- `CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (default `24`)
- `CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (default `5`)

Provider support matrix:

- Communication:
  - `slack`: implemented
  - `microsoft_teams`: implemented
- Code host:
  - `github`: implemented
  - `bitbucket`: implemented
- Deploy:
  - `digitalocean`: implemented
  - `aws`: implemented (CodePipeline)

### How To Get Each Value

`COMMUNICATION_PROVIDER`

- Provider selector for communication integration.
- Supported values: `slack` (implemented), `microsoft_teams` (implemented).
- Default: `slack`.

`CODE_HOST_PROVIDER`

- Provider selector for code-host integration.
- Supported values: `github` (implemented), `bitbucket` (implemented).
- Default: `github`.

`DEPLOY_PROVIDER`

- Provider selector for deploy integration.
- Supported values: `digitalocean` (implemented), `aws` (implemented via CodePipeline).
- Default: `digitalocean`.

`DEPLOY_REGION`

- Deploy provider region.
- Used by AWS CodePipeline deploy provider.
- Default: `us-east-1`.

`DEPLOY_ACCESS_KEY_ID`

- Access key id used by AWS deploy provider request signing.

`DEPLOY_SECRET_ACCESS_KEY`

- Secret access key used by AWS deploy provider request signing.

`DEPLOY_SESSION_TOKEN`

- Optional session token for temporary AWS credentials.

`BOT_NAME`

- Display name used in bot-generated help and error messages.
- Default: `Calypso`.

`COMMUNICATION_BOT_TOKEN`

- Slack App -> `OAuth & Permissions` -> install/reinstall app -> copy `Bot User OAuth Token` (`xoxb-...`).
- Add bot scope `users:read` so Calypso can detect workspace admins for deploy authorization.

`COMMUNICATION_APP_TOKEN`

- Slack App -> `Socket Mode` -> enable -> generate app-level token with `connections:write` scope -> copy token (`xapp-...`).

`COMMUNICATION_COMMAND_PATH`

- Provider-agnostic HTTP path for incoming communication command requests.
- Used by `microsoft_teams` provider for Calypso command ingestion.
- Default: `/communication/commands`.

`COMMUNICATION_WEBHOOK_URL`

- Provider-agnostic outbound webhook URL for communication platforms that support webhook posting.
- Used by `microsoft_teams` for in-channel recap posts and follow-up channel messages.

`COMMUNICATION_ADMIN_USER_IDS`

- Optional comma-separated user IDs treated as workspace admins when `COMMUNICATION_PROVIDER=microsoft_teams`.

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

`CODE_HOST_CODEX_USER_LOGINS` (optional)

- Comma-separated GitHub logins that count as "Codex approved" when they react 👍 to the PR description.
- Default: `codex,codex[bot]`.
- Example: `CODE_HOST_CODEX_USER_LOGINS=codex,openai-codex[bot]`

`CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (optional)

- How often Calypso reconciles open PR review state from GitHub API.
- Default: `24`.

`CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (optional)

- How often Calypso refreshes Codex 👍 approval from PR-description reactions.
- Default: `5`.

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

## Hosting

### Pricing Snapshot (DigitalOcean)

Estimated monthly costs as of 2026-02-16:

- App Platform web service (`apps-s-1vcpu-0.5gb`) starts at `$5/mo`.
- Managed PostgreSQL single node (1 GiB) starts at `$15/mo`.
- Basic Droplets currently show `$4/mo` (512 MiB) and `$6/mo` (1 GiB).

Practical options:

- App Platform + Managed PostgreSQL: about `$20/mo` minimum.
- Single Droplet hosting app + Postgres yourself: about `$4-$6/mo` minimum.
- Droplet + Managed PostgreSQL: about `$19-$21/mo` minimum.

Notes:

- App Platform static sites have a free tier, but Calypso needs a running web service.
- App Platform additional outbound transfer is billed at `$0.02/GiB`.

### Host Locally (Fastest Development Setup)

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with required values.
3. Start the managed local stack:

```bash
npm run start
```

This local command starts:

- Temporary Postgres at `.tmp/calypso-pg` (first run initializes it).
- ngrok tunnel on `PORT` (default `3000`).
- Calypso app process.

4. Configure your code-host webhook to the printed ngrok URL:

- `https://<ngrok-domain>/codehost/webhook`

5. Stop local runtime:

```bash
npm run stop
```

Optional local mode (you run your own Postgres + tunnel):

```bash
npm run dev
```

### Host on DigitalOcean App Platform (Managed PaaS)

Calypso is already set up for this:

- Dockerized runtime (`Dockerfile`).
- HTTP health endpoint (`GET /healthz`).
- Public webhook route (`/codehost/webhook`).
- Startup migrations run automatically.

Steps:

1. Create a DigitalOcean Managed PostgreSQL cluster.
2. Copy DB URL and keep `sslmode=require` in `DATABASE_URL`.
3. Create App Platform app from this repo using the root `Dockerfile`.
4. Configure as a Web Service, one instance.
5. Set environment variables in App Platform:
   - Required:
     - `DATABASE_URL`
     - `COMMUNICATION_PROVIDER=slack`
     - `COMMUNICATION_BOT_TOKEN`
     - `COMMUNICATION_APP_TOKEN`
     - `CODE_HOST_PROVIDER=github`
     - `CODE_HOST_WEBHOOK_SECRET`
     - `CODE_HOST_REPOSITORY`
     - `CODE_HOST_MAIN_BRANCH`
   - Optional:
     - `BOT_NAME`
     - `PORT` (defaults to `3000`)
     - `CODE_HOST_TOKEN` (enables `/calypso sync` and scheduled backfill)
     - `DEPLOY_PROVIDER=digitalocean`
     - `DEPLOY_TOKEN`
     - `DEPLOY_PROD_APP_ID`
6. Configure App health check path to `/healthz`.
7. Deploy the app.
8. Set webhook URL to `https://<your-app-domain>/codehost/webhook`.
9. Smoke test:
   - `/calypso help`
   - `/calypso status`
   - merge a PR and confirm webhook delivery `200`.

### Host on a DigitalOcean Droplet (Cheapest Always-On)

This repo includes `docker-compose.droplet.yml` and `Caddyfile.droplet` for this flow.

1. Create an Ubuntu Droplet (1 GiB recommended).
2. Point a domain `A` record to the Droplet IP (example: `calypso.example.com`).
3. Open inbound ports `22`, `80`, `443` in DO firewall.
4. SSH in and install Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
```

5. Clone this repo and create `.env` in repo root.
6. In `.env`, use a local Compose DB URL:
   - `POSTGRES_PASSWORD=<strong-password>`
   - `CADDY_EMAIL=you@yourdomain.com`
   - `DATABASE_URL=postgresql://calypso_user:<POSTGRES_PASSWORD>@db:5432/calypso`
7. Update `Caddyfile.droplet`:
   - replace `calypso.example.com` with your domain
8. Start the stack:

```bash
docker compose -f docker-compose.droplet.yml up -d --build
```

9. Verify health:

```bash
curl https://<your-domain>/healthz
```

10. Configure webhook:
   - `https://<your-domain>/codehost/webhook`

Operational notes:

- Slack Socket Mode means slash commands do not require a public Slack request URL.
- Keep one primary Calypso runtime for stable webhook ingestion and schedulers.
- If you use the Droplet Compose DB service, do not expose `5432` publicly.

Pricing references:

- App Platform pricing: https://www.digitalocean.com/pricing/app-platform
- Managed PostgreSQL pricing: https://www.digitalocean.com/pricing/managed-databases
- Droplet pricing: https://www.digitalocean.com/pricing/droplets

## Code-Host Webhook

Endpoint:

- `POST /codehost/webhook`

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
- Reconciles Codex approval by checking current 👍 reactions on PR descriptions from configured `CODE_HOST_CODEX_USER_LOGINS`.
- Upserts all currently open PR review-state rows and marks stale local open rows as `closed`.
- Backfills merged PRs newer than last prod deploy into deploy-gating state as `untested` (without downgrading already `tested`/`deployed` rows).

## Codex Approval Sync

- Runs as a separate background scheduler in the app runtime.
- Refreshes `codex_approved` using PR-description 👍 reactions from configured `CODE_HOST_CODEX_USER_LOGINS`.
- Frequency is controlled by `CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (default every 5 minutes).
- Requires `CODE_HOST_TOKEN`.

## Slash Command Behavior

`/calypso help`

- Returns usage.

`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`

- Sets workspace recap target channel for scheduled in-channel posts.

`/calypso config review-recap-recency:<Nd|Nw>`

- Sets recap lookback window (for example `1w`, `2w`, `2d`).

`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`

- Sets one or more recap send slots using `daily` or weekday + 24h clock.
- Examples: `daily@09:00`, `daily@09:00,17:00`, `mon@09:00,17:30`, `tue@10:15`.

`/calypso config timezone:America/New_York`

- Sets timezone (IANA), used by human timestamps and recap schedule rendering.

`/calypso config communication-provider:slack|microsoft_teams`

- Sets communication platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config code-host-provider:github|bitbucket`

- Sets code-host platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config deploy-provider:digitalocean|aws`

- Sets deploy platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

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

## Review Recap

- Runs as a background scheduler in the app runtime.
- Checks once per minute for configured recap slot (`daily@HH:MM` or `<weekday>@HH:MM`).
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
