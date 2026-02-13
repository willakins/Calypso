# Calypso — Validation Playbook

## General Notes

- Run validations from repo root.
- Prefer real “can it run” checks over just linting.
- If a command requires external services (Slack, Postgres), document prerequisites.

## Common Prereqs

- Node installed
- `.env` configured
- Postgres reachable at DATABASE_URL
- Slack app already created with Socket Mode and `/calypso` command

---

## CHUNK-01-SLACK-BOOT Validation

### Commands

1. Install deps (if needed):
   - `npm install`
2. Start bot:
   - `npm run dev`

### Manual check

- In Slack, run:
  - `/calypso help`
- Expected:
  - Bot responds with usage text (no errors in console)

Pass criteria:

- No startup crash
- Slack command response received

---

## CHUNK-02-POSTGRES-INIT Validation

### Commands

1. Ensure DATABASE_URL points to a running Postgres.
2. Start bot:
   - `npm run dev`

### Expected

- On startup, migrations run (idempotent)
- Tables exist: `pull_requests`, `deployments`
- No unhandled promise rejections

Optional quick DB check (manual):

- `psql "$DATABASE_URL" -c "\dt"`

Pass criteria:

- App starts successfully with DB connected
- Tables created

---

## CHUNK-03-STATUS-COMMAND Validation

### Commands

- `npm run dev`

### Manual checks

1. `/calypso status` with empty DB
   - Expected: “No blockers…” message
2. Insert a fake PR row (manual psql), then re-run `/calypso status`
   - If no deployments exist, PR should appear as blocking (since epoch baseline)

Pass criteria:

- Status output matches blockers logic

---

## CHUNK-04-GITHUB-WEBHOOK Validation

### Commands

- `npm run dev` (service must expose /github/webhook on PORT)
- Use a tunnel (ngrok/cloudflared) to expose local PORT to GitHub, OR simulate locally.

### Manual checks (recommended)

1. Send a request with invalid signature → should return 401
2. Send a valid signed webhook payload for a merged PR → row created/updated as untested

Pass criteria:

- Signature verification works
- PR upsert works

---

## CHUNK-05-TESTED-COMMAND Validation

### Manual checks

1. Ensure at least one PR exists in DB.
2. `/calypso tested <PR_NUMBER>`
   - Expected: confirmation message
3. `/calypso status`
   - Expected: PR no longer blocks (if it was the only blocker)

Pass criteria:

- DB updated (status=tested, tested_at set, tested_by set)
- Slack responses correct

---

## CHUNK-06-DEPLOY-GATE Validation

### Manual checks

1. With blockers present:
   - `/calypso deploy prod`
   - Expected: refused + lists blockers
2. With zero blockers:
   - unset DO env vars (or leave missing)
   - `/calypso deploy prod`
   - Expected: “deploy not configured” (and does not crash)

Pass criteria:

- Gate blocks correctly and does not attempt deploy when blocked
- Clear messaging

---

## CHUNK-07-DIGITALOCEAN-DEPLOY Validation

### Manual checks

1. Set DIGITALOCEAN_TOKEN and DO_APP_ID_PROD
2. Ensure no blockers exist
3. `/calypso deploy prod`
   - Expected: DO deploy triggered
   - DB: deployments row inserted
   - PRs since last deploy marked deployed

Failure-mode check:

- Use an invalid DO token
- Ensure deploy fails and does not insert deployment row or mark PRs deployed

Pass criteria:

- Success path writes correct DB updates
- Failure path does not mutate DB state (besides logs)
