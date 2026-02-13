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
3. Run offline command tests:
   - `npm test`

### Expected

- Bolt app initializes and command registration executes.
- No startup exception while running `npm run dev`.
- Offline tests pass, including direct invocation of `handleCalypsoCommand`.

Pass criteria:

- No startup crash
- Offline handler tests pass

Optional manual Slack smoke test:

- In Slack, run `/calypso help`
- Expected: bot responds with usage text (no runtime errors in console)

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
- `npm test`

### Offline checks

1. With empty `deployments` and `pull_requests`, run a local status check script (or call DB helpers directly).
   - Expected: epoch baseline (`1970-01-01T00:00:00.000Z`) and “No blockers…” output
2. Insert a fake untested PR row, then run the local status check script again.
   - Expected: PR appears as blocking when no deployments exist.

Optional manual Slack smoke test:

1. `/calypso status` with empty DB
   - Expected: “No blockers…” message
2. Insert a fake PR row (manual psql), then re-run `/calypso status`
   - Expected: PR appears as blocking (epoch baseline when no deployments exist)

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

### Offline checks

1. Ensure at least one PR exists in DB.
2. Run local command-flow simulation for `tested <PR_NUMBER>` (direct handler invocation is fine).
   - Expected: confirmation message
3. Run local status check afterward.
   - Expected: PR no longer blocks (if it was the only blocker)

Pass criteria:

- DB updated (status=tested, tested_at set, tested_by set)
- Command responses correct

Optional manual Slack smoke test:

1. `/calypso tested <PR_NUMBER>` in Slack
2. `/calypso status`
3. Confirm the tested PR no longer appears as a blocker

---

## CHUNK-06-DEPLOY-GATE Validation

### Offline checks

1. With blockers present:
   - Simulate `/calypso deploy prod` via local command handler.
   - Expected: refused + lists blockers
2. With zero blockers:
   - keep DO env vars missing
   - simulate `/calypso deploy prod` via local command handler
   - Expected: “deploy not configured” (and does not crash)

Pass criteria:

- Gate blocks correctly and does not attempt deploy when blocked
- Clear messaging

Optional manual Slack smoke test:

1. `/calypso deploy prod` with blockers present
2. `/calypso tested <PR_NUMBER>` until blockers clear
3. `/calypso deploy prod` again and confirm “deploy not configured”

---

## CHUNK-07-DIGITALOCEAN-DEPLOY Validation

### Offline checks

1. Seed at least one `tested` PR with no blockers.
2. Simulate `/calypso deploy prod` with an injected successful deploy function.
   - Expected: deploy response indicates success
   - DB: `deployments` row inserted
   - PRs since last deploy marked `deployed`

Failure-mode check:

- Simulate `/calypso deploy prod` with an injected failing deploy function.
- Ensure deploy fails and does not insert deployment row or mark PRs deployed.

Pass criteria:

- Success path writes correct DB updates
- Failure path does not mutate DB state (besides logs)

Optional manual live deploy smoke test:

1. Set real `DIGITALOCEAN_TOKEN` and `DO_APP_ID_PROD`
2. Ensure no blockers exist
3. Run `/calypso deploy prod`
4. Verify DO deployment trigger and DB updates
