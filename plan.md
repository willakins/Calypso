# Calypso — Slack Deployment Gatekeeper (Postgres)

## PURPOSE

We deploy production manually via Slack + DigitalOcean UI. We are not consistently testing merged PRs before prod deploy.
Calypso enforces:

- merged PRs are UNTESTED by default
- engineers mark PRs TESTED via Slack
- prod deploy is BLOCKED if any merged PRs since last prod deploy remain untested
- if clear, Calypso can optionally trigger DigitalOcean App Platform deploy (force rebuild)

Tone: calm, clear, mildly authoritative.

---

## STATUS

- PROJECT_STATE: in_progress
- NEXT_CHUNK: CHUNK-01-SLACK-BOOT
- REPO_DEFAULT_BRANCH: main

---

## CONFIG (ENV VARS)

### Required for local Slack + DB

- SLACK_BOT_TOKEN = xoxb-...
- SLACK_APP_TOKEN = xapp-... (Socket Mode)
- DATABASE_URL = postgres://...

### Required for GitHub ingestion

- GITHUB_WEBHOOK_SECRET = ...
- GITHUB_REPO = croft-eng/croft
- GITHUB_MAIN_BRANCH = main

### Optional for DigitalOcean deploy

- DIGITALOCEAN_TOKEN = ...
- DO_APP_ID_PROD = ...
- DEPLOY_CHANNEL_ID = C123...

### Local hosting notes

- Slack uses Socket Mode → no public URL required for Slack commands.
- GitHub webhooks require a public URL → use ngrok/cloudflared during local dev.

---

## SYSTEM OVERVIEW

Single Node service containing:

- Slack Bolt app (Socket Mode) handling `/calypso`
- Express server for `POST /github/webhook`
- Postgres persistence via `pg`
- DigitalOcean API client (optional)

No background workers in v1.

---

## DATA MODEL

### pull_requests

State machine: merged → untested → tested → deployed

### deployments

Record each prod deploy attempt that succeeded in triggering DO (or “dry run” if configured later).

---

## BEHAVIORAL INVARIANTS

- A PR merged into GITHUB_MAIN_BRANCH is stored as status=untested.
- `/calypso deploy prod` must refuse deploy if any blocking PRs exist.
- Blocking PR = merged_at > last_prod_deploy_at AND status not in (tested, deployed)
- A successful deploy inserts a deployments row BEFORE marking PRs as deployed.
- If DO API call fails, do NOT insert deployment row and do NOT mark PRs deployed.

Bootstrap mode (v1): strict

- If there is no prior prod deployment, last_deploy_at = 1970-01-01, so all merged PRs block until tested.

---

## FILE STRUCTURE (TARGET)

- src/
  - app.js
  - config.js
  - commands/calypso.js
  - db/
    - index.js
    - migrations/001_init.sql
  - integrations/
    - github/
      - webhook.js
      - verify_signature.js
    - digitalocean/
      - client.js
  - util/format.js
- plan.md
- AGENTS.md
- VALIDATION.md

---

## CHUNKS (IMPLEMENT IN ORDER)

### CHUNK-01-SLACK-BOOT

- GOAL: Bot runs locally in Socket Mode and responds to `/calypso help`
- INPUTS: SLACK_BOT_TOKEN, SLACK_APP_TOKEN
- OUTPUTS: working Bolt app skeleton + command router
- ACCEPTANCE:
  - running `npm run dev` starts without errors
  - `/calypso help` responds in Slack
- VALIDATION: see VALIDATION.md (CHUNK-01)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG: `npm install` pass; `npm run dev` starts but Slack Socket Mode connection blocked in sandbox (`getaddrinfo ENOTFOUND slack.com`); `SLACK_BOT_TOKEN= SLACK_APP_TOKEN= npm run dev` fail-fast check pass.
  - BLOCKER: Manual `/calypso help` Slack verification requires network-enabled runtime.

### CHUNK-02-POSTGRES-INIT

- GOAL: Postgres connectivity + idempotent migrations run at startup
- INPUTS: DATABASE_URL
- OUTPUTS: db module + migrations/001_init.sql created and applied
- ACCEPTANCE:
  - app starts and ensures tables exist
  - simple `SELECT 1` works via pool
- VALIDATION: see VALIDATION.md (CHUNK-02)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

### CHUNK-03-STATUS-COMMAND

- GOAL: `/calypso status` returns blockers since last prod deploy (empty state OK)
- INPUTS: DB schema present
- OUTPUTS: query functions + Slack formatting
- ACCEPTANCE:
  - if no deployments exist, last_deploy_at treated as epoch
  - status prints “no blockers” when none exist
- VALIDATION: see VALIDATION.md (CHUNK-03)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

### CHUNK-04-GITHUB-WEBHOOK

- GOAL: Receive GitHub PR merge webhook, verify signature, upsert PR as untested
- INPUTS: GITHUB_WEBHOOK_SECRET, GITHUB_REPO, GITHUB_MAIN_BRANCH
- OUTPUTS: Express route `/github/webhook` + signature verifier + upsert query
- ACCEPTANCE:
  - invalid signature returns 401
  - merged PR into main creates/updates pull_requests row status=untested
- VALIDATION: see VALIDATION.md (CHUNK-04)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

### CHUNK-05-TESTED-COMMAND

- GOAL: `/calypso tested <PR_NUMBER>` marks PR tested by Slack user
- INPUTS: pull_requests row exists
- OUTPUTS: update query + Slack response
- ACCEPTANCE:
  - idempotent if already tested
  - clear message if PR not found
- VALIDATION: see VALIDATION.md (CHUNK-05)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

### CHUNK-06-DEPLOY-GATE

- GOAL: `/calypso deploy prod` blocks on untested PRs, otherwise proceeds to “ready” state
- INPUTS: status + tested logic
- OUTPUTS: gating logic + response
- ACCEPTANCE:
  - lists blockers when present
  - if none present and DO not configured: responds “deploy not configured”
- VALIDATION: see VALIDATION.md (CHUNK-06)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

### CHUNK-07-DIGITALOCEAN-DEPLOY

- GOAL: When unblocked, trigger DO App Platform deployment (force rebuild), record deployment, mark PRs deployed
- INPUTS: DIGITALOCEAN_TOKEN, DO_APP_ID_PROD
- OUTPUTS: DO client + deploy flow
- ACCEPTANCE:
  - on success: deployment row inserted and PRs marked deployed
  - on failure: no DB mutation beyond logs
- VALIDATION: see VALIDATION.md (CHUNK-07)
- STATUS:
  - DONE: [ ]
  - COMPLETED_AT:
  - VALIDATED: no
  - VALIDATION_LOG:

---

## HANDOFFS (for parallel / later agents)

- ID: HANDOFF-CHUNK-01-MANUAL-SLACK-VALIDATION
- Goal: Validate CHUNK-01 against live Slack by running Socket Mode bot and confirming `/calypso help` ephemeral response.
- Files likely touched: `plan.md` (status updates only, unless fixes are needed).
- Validation steps: run `npm run dev`; execute `/calypso help` in Slack; confirm terminal has no runtime errors; if successful, set CHUNK-01 `DONE: [x]`, `COMPLETED_AT`, `VALIDATED: yes`, and advance `NEXT_CHUNK` to `CHUNK-02-POSTGRES-INIT`.

---

## NOTES / DECISIONS LOG

- Bootstrap mode is strict (epoch last_deploy_at).
- v1 avoids Slack Block Kit buttons.
- v1 is single-repo (GITHUB_REPO).
