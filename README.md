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
- A running Postgres instance.
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
- `DEPLOY_CHANNEL_ID` (reserved for future use)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with required values.
3. Start the app:

```bash
npm run dev
```

On startup Calypso will:

- Verify DB connectivity (`SELECT 1`).
- Run migrations (`001_init.sql`) idempotently.
- Start webhook server on `PORT`.
- Start Slack Socket Mode.

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

`/calypso deploy prod`

- Blocks when untested blockers exist.
- If no blockers and DigitalOcean env vars missing, returns "deploy not configured".
- If configured and deploy succeeds:
  - inserts a `deployments` row
  - marks tested PRs since last deploy as `deployed`
- If deploy fails:
  - does not write deployment row
  - does not mark PRs deployed

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
