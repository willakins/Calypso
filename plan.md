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

- PROJECT_STATE: completed
- NEXT_CHUNK: NONE
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
  - `handleCalypsoCommand({ text, user_id })` returns expected help/error responses
  - (optional smoke) `/calypso help` responds in Slack
- VALIDATION: see VALIDATION.md (CHUNK-01)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:08:06Z
  - VALIDATED: yes
  - VALIDATION_LOG: `npm install` pass; `npm run dev` pass for startup/no exception (network warnings only in sandbox); `npm test` pass (4/4); `node -e "require('./src/commands/calypso').handleCalypsoCommand(...)"` pass.

### CHUNK-02-POSTGRES-INIT

- GOAL: Postgres connectivity + idempotent migrations run at startup
- INPUTS: DATABASE_URL
- OUTPUTS: db module + migrations/001_init.sql created and applied
- ACCEPTANCE:
  - app starts and ensures tables exist
  - simple `SELECT 1` works via pool
- VALIDATION: see VALIDATION.md (CHUNK-02)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:19:36Z
  - VALIDATED: yes
  - VALIDATION_LOG: `DATABASE_URL=postgresql://calypso_user@127.0.0.1:5433/postgres npm run dev` pass twice (idempotent); `psql ... -c "\dt"` shows `pull_requests` and `deployments`; `psql ... -c "SELECT 1"` pass.

### CHUNK-03-STATUS-COMMAND

- GOAL: `/calypso status` returns blockers since last prod deploy (empty state OK)
- INPUTS: DB schema present
- OUTPUTS: query functions + Slack formatting
- ACCEPTANCE:
  - if no deployments exist, last_deploy_at treated as epoch
  - status prints “no blockers” when none exist
- VALIDATION: see VALIDATION.md (CHUNK-03)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:26:02Z
  - VALIDATED: yes
  - VALIDATION_LOG: `DATABASE_URL=postgresql://calypso_user@127.0.0.1:5433/postgres npm run dev` pass; `npm test` pass (6/6); `TRUNCATE` + offline status script checks pass for empty state (epoch baseline) and blocking state (1 blocker).

### CHUNK-04-GITHUB-WEBHOOK

- GOAL: Receive GitHub PR merge webhook, verify signature, upsert PR as untested
- INPUTS: GITHUB_WEBHOOK_SECRET, GITHUB_REPO, GITHUB_MAIN_BRANCH
- OUTPUTS: Express route `/github/webhook` + signature verifier + upsert query
- ACCEPTANCE:
  - invalid signature returns 401
  - merged PR into main creates/updates pull_requests row status=untested
- VALIDATION: see VALIDATION.md (CHUNK-04)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:34:45Z
  - VALIDATED: yes
  - VALIDATION_LOG: `PORT=3200 DATABASE_URL=... GITHUB_* ... npm run dev` pass; invalid signed `POST /github/webhook` returned 401; valid signed pull_request webhook returned 200 and upserted `pull_requests.status=untested` for PR #101.

### CHUNK-05-TESTED-COMMAND

- GOAL: `/calypso tested <PR_NUMBER>` marks PR tested by Slack user
- INPUTS: pull_requests row exists
- OUTPUTS: update query + Slack response
- ACCEPTANCE:
  - idempotent if already tested
  - clear message if PR not found
- VALIDATION: see VALIDATION.md (CHUNK-05)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:36:19Z
  - VALIDATED: yes
  - VALIDATION_LOG: Seeded PR #200 as `untested`; offline command-flow simulation `tested 200` returned confirmation, second call idempotent, and `status` showed no blockers; DB verified `status=tested`, `tested_at` set, `tested_by=U_TESTER`.

### CHUNK-06-DEPLOY-GATE

- GOAL: `/calypso deploy prod` blocks on untested PRs, otherwise proceeds to “ready” state
- INPUTS: status + tested logic
- OUTPUTS: gating logic + response
- ACCEPTANCE:
  - lists blockers when present
  - if none present and DO not configured: responds “deploy not configured”
- VALIDATION: see VALIDATION.md (CHUNK-06)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:41:21Z
  - VALIDATED: yes
  - VALIDATION_LOG: Seeded untested PR #300 and simulated `/calypso deploy prod` -> blocked with blocker list; after `/calypso tested 300`, simulated deploy returned “deploy not configured” when DO env vars absent.

### CHUNK-07-DIGITALOCEAN-DEPLOY

- GOAL: When unblocked, trigger DO App Platform deployment (force rebuild), record deployment, mark PRs deployed
- INPUTS: DIGITALOCEAN_TOKEN, DO_APP_ID_PROD
- OUTPUTS: DO client + deploy flow
- ACCEPTANCE:
  - on success: deployment row inserted and PRs marked deployed
  - on failure: no DB mutation beyond logs
- VALIDATION: see VALIDATION.md (CHUNK-07)
- STATUS:
  - DONE: [x]
  - COMPLETED_AT: 2026-02-13T17:46:00Z
  - VALIDATED: yes
  - VALIDATION_LOG: Offline success simulation inserted deployment row and marked tested PR as deployed; offline failure simulation produced error response and left deployments/PR state unchanged (no mutation beyond logs).

---

## HANDOFFS (for parallel / later agents)

- ID: HANDOFF-CHUNK-01-OPTIONAL-SLACK-SMOKE
- Goal: Run optional live Slack smoke test for `/calypso help` in a network-enabled environment.
- Files likely touched: `plan.md` (validation note only if you want to record smoke test outcome).
- Validation steps: run `npm run dev`; execute `/calypso help` in Slack; confirm ephemeral response and no runtime exceptions.
- ID: HANDOFF-CHUNK-03-OPTIONAL-SLACK-SMOKE
- Goal: Run optional live Slack smoke test for `/calypso status` behavior in Slack.
- Files likely touched: `plan.md` (validation note only if you want to record smoke test outcome).
- Validation steps: with empty DB run `/calypso status` and confirm “No blockers”; insert a fake untested PR row and confirm `/calypso status` lists the blocker.
- ID: HANDOFF-CHUNK-04-OPTIONAL-GITHUB-LIVE-WEBHOOK
- Goal: Run optional live GitHub webhook smoke test from GitHub to local/ngrok endpoint.
- Files likely touched: none (or `plan.md` notes only).
- Validation steps: configure webhook to `/github/webhook`; send merged PR event to `main`; confirm row inserted/updated with `status=untested`.
- ID: HANDOFF-CHUNK-05-OPTIONAL-SLACK-SMOKE
- Goal: Run optional live Slack smoke test for `/calypso tested <PR_NUMBER>`.
- Files likely touched: `plan.md` notes only.
- Validation steps: run `/calypso tested <PR_NUMBER>` and `/calypso status` in Slack; confirm the PR no longer appears as blocking.
- ID: HANDOFF-CHUNK-06-OPTIONAL-SLACK-SMOKE
- Goal: Run optional live Slack smoke test for deploy-gate messaging.
- Files likely touched: `plan.md` notes only.
- Validation steps: run `/calypso deploy prod` with blockers (expect refusal), clear blockers, rerun and confirm “deploy not configured” when DO vars are missing.
- ID: HANDOFF-CHUNK-07-OPTIONAL-LIVE-DO-SMOKE
- Goal: Run optional live DigitalOcean deploy smoke test with real credentials.
- Files likely touched: `plan.md` notes only.
- Validation steps: set real DO env vars, ensure no blockers, run `/calypso deploy prod`, confirm DO deploy trigger and DB updates.

---

## NOTES / DECISIONS LOG

- Bootstrap mode is strict (epoch last_deploy_at).
- v1 avoids Slack Block Kit buttons.
- v1 is single-repo (GITHUB_REPO).
