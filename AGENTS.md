# Calypso Bot — Agent Guide (Post-Baseline)

This project is now in steady-state mode. Use this file as the default operating guide for future changes.

## Product Context

Calypso is a Slack-first deployment gatekeeper for one GitHub repository.

- Slack command surface: `/calypso`
- GitHub ingestion endpoint: `POST /github/webhook`
- Persistence: Postgres
- Optional deployment trigger: DigitalOcean App Platform

Core behavior:

- Merged PRs are tracked as `untested`
- Engineers mark PRs as tested via Slack
- `/calypso deploy prod` is blocked if untested PRs exist since last prod deploy
- If clear and configured, Calypso triggers a DO deployment and records deploy state

## Non-Negotiable Invariants

- Never allow deploy when blocking PRs exist.
- If DO deploy call fails, do not write deployment row and do not mark PRs deployed.
- If no prior prod deployment exists, baseline remains epoch (`1970-01-01...`).
- Webhook handling must verify signature before processing payloads.
- Webhook ingestion only applies to configured repo + main branch.

## Architecture Boundaries

- `src/app.js`: composition root only (wiring/startup), minimal business logic.
- `src/commands/types/*`: each command owns parse + execute behavior.
- `src/commands/registry/*`: command lookup/dispatch only.
- `src/commands/services/*`: runtime dependency wiring/orchestration.
- `src/integrations/github/*`: signature verification + webhook event mapping.
- `src/integrations/digitalocean/*`: DO API client only.
- `src/db/*`: SQL access and data-state transitions.
- `src/util/*`: pure formatting/helper functions.

## Preferred Implementation Patterns

- Keep modules single-purpose and intention-revealing.
- Prefer pure functions for parsing/formatting/mapping logic.
- Keep side effects at boundaries (HTTP handlers, DB calls, external API calls).
- Add new Slack commands by:
1. Adding a command class under `src/commands/types/`.
2. Registering it in `src/commands/registry/calypso_command_registry.js`.
- Use explicit, user-facing error messages for command failures.
- Use database transactions for multi-step state changes.

## Testing Rules

- Every behavior change should include or update tests.
- Keep tests high-value and behavior-oriented, not implementation-coupled.
- Minimum checks before handoff:
1. `npm test` passes
2. New/changed behavior is covered in test files under `test/`

## Deployment & Runtime Rules

- Local developer convenience scripts:
  - `npm run start` (managed local stack)
  - `npm run stop`
  - `npm run dev` (app only)
- Hosted runtime uses Docker (`Dockerfile`) and real managed Postgres.
- For managed Postgres, use `DATABASE_URL` with `sslmode=require`.
- Keep one primary always-on runtime for reliable webhook ingestion.

## Security & Operations

- Never commit secrets or `.env`.
- Treat exposed secrets as compromised; rotate immediately.
- Keep token scopes minimal (Slack, GitHub webhook secret, DO token).
- Preserve auditability in logs and deploy state transitions.

## Change Discipline

- Prefer small, reviewable diffs.
- Avoid broad rewrites unless explicitly requested.
- Preserve current behavior unless the request requires a behavior change.
- Update `README.md` when operational setup or public behavior changes.
