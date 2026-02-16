# Open PR Review Recap Validation

## Chunk Status
| Chunk | Owner | Status | PR/Commit | Notes |
| --- | --- | --- | --- | --- |
| 1. DB foundation | Codex | Complete | local | Added migration `006`, new DB APIs for review recap config and open PR review state, and DB tests |
| 2. Webhook PR-review ingestion | Codex | Complete | local | Extended webhook to process `pull_request` + `pull_request_review` with tracked repo/branch gating |
| 3. Recap formatting utilities | Codex | Complete | local | Added recap header/row/empty formatting and recency label helpers with tests |
| 4. Config command extensions | Codex | Complete | local | Added `review-recap-*` config parsing + execution paths and tests |
| 5. Help/docs command surface | Codex | Complete | local | Updated `/calypso help` and config usage messaging for recap options |
| 6. Scheduler runtime | Codex | Complete | local | Added minute-based scheduler tick with dedupe against `last_sent_slot_at` |
| 7. End-to-end behavior + docs | Codex | Complete | local | Added high-level recap flow test and README updates for webhook/commands/scheduler |

## Automated Checks
- [x] Run `npm test` after each chunk.
- [x] Validate touched test files for each chunk.

## Manual Smoke Checks
- [ ] GitHub webhook delivery returns `200`.
- [ ] `/calypso config review-recap-*` accepts valid input and rejects invalid input.
- [ ] Scheduled recap post appears in configured channel.
- [ ] Scheduled empty-state recap appears when no matching PRs exist.

## Regression Checks
- [x] Deploy gate behavior unchanged.
- [x] `/calypso tested` behavior unchanged.
- [x] `/calypso deploy prod` in-channel visibility unchanged.

## Execution Notes
### Chunk 1
- Added `src/db/migrations/006_open_pr_reviews_and_recap_config.sql` with:
  - `open_pr_review_state` table and lifecycle/review constraints.
  - `review_recap_config` singleton table and seeded defaults.
- Expanded `src/db/index.js` with:
  - Open PR review state APIs:
    - `upsertOpenPullRequestReviewState`
    - `updatePullRequestReviewSubmission`
    - `listOpenPullRequestsWaitingOnReviewSince`
  - Workspace recap config APIs:
    - `getReviewRecapConfig`
    - `setReviewRecapChannel`
    - `setReviewRecapRecency`
    - `setReviewRecapSchedule`
    - `setReviewRecapTimeZone`
    - `markReviewRecapSent`
- Added DB tests in `test/db.test.js` for all new accessors and validation errors.
- Validation: `npm test` passed.

### Chunk 2
- Reworked `src/integrations/github/webhook.js` to:
  - accept both `pull_request` and `pull_request_review` events.
  - enforce tracked repo + main branch for review tracking.
  - preserve merged PR deploy-gate upsert behavior.
  - track PR lifecycle transitions (`opened`, `ready_for_review`, `converted_to_draft`, `synchronize`, `review_requested`, `reopened`, `closed`).
  - apply review submission updates on `pull_request_review` `submitted` (`approved`, `changes_requested`, and `commented` timestamp-only updates).
- Added/updated webhook tests in `test/github-webhook.test.js` for all new paths.
- Validation: targeted webhook+db tests and full `npm test` passed.

### Chunk 3
- Added recap format utilities in `src/util/format.js`:
  - `formatReviewRecapResponse`
  - `formatReviewRecencyLabel`
- Ensured output matches required format:
  - header with recency label
  - row with PR link/title/author/opened-for-review timestamp
  - explicit empty state `• None`
- Added tests in `test/format.test.js` for recency labels, populated recap, and empty recap.
- Validation: targeted format tests passed.

### Chunk 4
- Extended `src/commands/types/config_command.js` to support:
  - `review-recap-channel:<#CHANNEL|CHANNEL_ID>`
  - `review-recap-recency:<Nd|Nw>`
  - `review-recap-schedule:<weekday>@HH:MM`
  - `review-recap-timezone:<IANA_TZ>`
- Added channel mention normalization (`<#C123|name>` -> `C123`).
- Wired new recap config setters into runtime in `src/commands/services/calypso_command_service.js`.
- Added parser/command execution tests in `test/calypso.test.js`.
- Validation: targeted command tests passed.

### Chunk 5
- Updated help surface in `src/commands/types/help_command.js` to include new recap config commands.
- Expanded usage coverage via `test/calypso.test.js` assertions.
- Validation: tests passed with updated help output.

### Chunk 6
- Added `src/review_recap/scheduler.js` with:
  - `startReviewRecapScheduler` (minute interval)
  - `runReviewRecapSchedulerTick` (testable core logic)
  - `findMostRecentScheduledSlot` (timezone-aware slot scan)
- Scheduler behavior:
  - no-op with info log when channel is unset
  - computes due slot in configured timezone
  - dedupes with `last_sent_slot_at`
  - posts in-channel recap via `chat.postMessage`
  - persists sent slot on success only
- Wired scheduler startup in `src/app.js` after service start.
- Added scheduler tests in `test/review-recap-scheduler.test.js`.
- Validation: targeted scheduler tests passed.

### Chunk 7
- Added `test/review-recap-high-level.test.js` covering:
  - webhook ingestion into open PR review state
  - slash config updates for recap controls
  - scheduler posting recap with configured recency/schedule/timezone/channel
- Updated `README.md` to document:
  - new recap capability
  - new config commands
  - webhook event coverage (`pull_request` + `pull_request_review`)
  - scheduler behavior and matching rules
- Validation: full `npm test` passed (`128` passing, `0` failing).
