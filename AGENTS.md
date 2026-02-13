# Calypso Bot — Agent Operating Instructions (Codex)

You are working in a repo that contains:

- plan.md (the source of truth for scope + progress)
- VALIDATION.md (how to validate work)
  Your job is to iteratively implement Calypso in small, validated chunks.

## Golden Rules

1. ALWAYS read plan.md first and treat it as authoritative.
2. Work in ONE chunk at a time (the chunk named in plan.md: `NEXT_CHUNK`).
3. Make changes only needed for the current chunk. Avoid “nice to haves”.
4. After implementing, ALWAYS run the validation steps for that chunk (see VALIDATION.md).
5. ALWAYS update plan.md after validation:
   - mark the chunk complete
   - record validation results
   - set a new `NEXT_CHUNK`
6. If validation fails, fix it before marking complete. If blocked, document the blocker in plan.md.

## Branching / Safety

- Use a single working branch unless instructed otherwise.
- Prefer small, reviewable commits per chunk.

## Workflow (must follow)

### Step 0 — Read plan

- Open plan.md
- Identify `NEXT_CHUNK`
- Identify its inputs/outputs and acceptance criteria

### Step 1 — Plan the chunk (brief)

- Write 3–8 bullet points describing exactly what you will implement
- List the files you expect to touch

### Step 2 — Implement

- Implement only what is required for the chunk
- Follow existing structure defined in plan.md

### Step 3 — Validate

- Run the chunk’s validation commands from VALIDATION.md
- Capture:
  - commands run
  - stdout/stderr summary
  - pass/fail

### Step 4 — Update plan.md (machine-operable edits)

In plan.md:

- Check off the chunk (`[x]`)
- Fill in:
  - `COMPLETED_AT`
  - `VALIDATED: yes`
  - `VALIDATION_LOG` (short)
  - any notes / follow-ups
- Set `NEXT_CHUNK` to the next chunk ID
- If you identified parallelizable work, write “handoff stubs” under `HANDOFFS`

### Step 5 — Handoff instructions (for subagents or next sessions)

At the end of plan.md, maintain a `HANDOFFS` section:

- Each handoff is a short task spec with:
  - ID
  - Goal
  - Files likely touched
  - Validation steps

If you cannot spawn subagents automatically, still write the handoff specs clearly so another agent/session can start immediately.

## Output Discipline

- Do not rewrite large parts of the repo unless required by the chunk.
- Do not add infrastructure (Docker, CI, cloud deploy) unless it is explicitly in plan.md scope.

## Code Style

- Node.js project
- Prefer plain JS (CommonJS) unless plan.md says otherwise
- Keep modules small and testable
- Avoid heavy frameworks beyond Bolt + Express + pg

## Required End-of-Chunk Summary (in final message to user)

After each chunk, provide:

- What you implemented
- Validation commands and results
- The updated `NEXT_CHUNK`
- Any handoffs created
