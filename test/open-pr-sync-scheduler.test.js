const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveReviewStateFromReviews,
  runOpenPullRequestSyncTick,
} = require("../src/open_pr_sync/scheduler");

test("deriveReviewStateFromReviews resolves final state across review timeline", () => {
  const reviewState = deriveReviewStateFromReviews([
    { state: "APPROVED", submitted_at: "2026-02-16T14:00:00.000Z" },
    { state: "COMMENTED", submitted_at: "2026-02-16T14:10:00.000Z" },
    { state: "DISMISSED", submitted_at: "2026-02-16T14:20:00.000Z" },
    { state: "CHANGES_REQUESTED", submitted_at: "2026-02-16T14:30:00.000Z" },
  ]);

  assert.equal(reviewState, "changes_requested");
});

test("runOpenPullRequestSyncTick upserts open PRs and closes stale rows", async () => {
  const calls = {
    closed: [],
    open: [],
    upserted: [],
  };

  await runOpenPullRequestSyncTick({
    githubClient: {
      async listOpenPullRequests() {
        return [
          {
            number: 71,
            title: "Improve metrics",
            html_url: "https://github.com/croft-eng/croft/pull/71",
            user: { login: "octocat" },
            base: { ref: "main" },
            draft: false,
            created_at: "2026-02-10T14:00:00.000Z",
          },
          {
            number: 72,
            title: "WIP",
            html_url: "https://github.com/croft-eng/croft/pull/72",
            user: { login: "octocat" },
            base: { ref: "main" },
            draft: true,
            created_at: "2026-02-11T14:00:00.000Z",
          },
        ];
      },
      async listPullRequestReviews({ prNumber }) {
        if (prNumber === 71) {
          return [{ state: "APPROVED", submitted_at: "2026-02-11T15:00:00.000Z" }];
        }
        return [];
      },
    },
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async (_pool, payload) => {
      calls.closed.push(payload);
      return 1;
    },
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repositoryFullName: "croft-eng/croft",
    upsertOpenPullRequestReviewStateFn: async (_pool, record) => {
      calls.upserted.push(record);
      calls.open.push(record.prNumber);
      return record;
    },
  });

  assert.equal(calls.upserted.length, 2);
  assert.equal(calls.upserted[0].reviewState, "approved");
  assert.equal(calls.upserted[1].reviewState, "waiting");
  assert.equal(calls.upserted[1].openedForReviewAt, null);
  assert.deepEqual(calls.open, [71, 72]);
  assert.equal(calls.closed.length, 1);
  assert.deepEqual(calls.closed[0], {
    repo: "croft-eng/croft",
    baseBranch: "main",
    openPrNumbers: [71, 72],
    closedAt: "2026-02-16T14:05:00.000Z",
  });
});

test("runOpenPullRequestSyncTick ignores open PRs not on tracked branch", async () => {
  const calls = {
    closed: [],
    upserted: [],
  };

  await runOpenPullRequestSyncTick({
    githubClient: {
      async listOpenPullRequests() {
        return [
          {
            number: 99,
            title: "Wrong branch",
            html_url: "https://github.com/croft-eng/croft/pull/99",
            user: { login: "octocat" },
            base: { ref: "develop" },
            draft: false,
            created_at: "2026-02-10T14:00:00.000Z",
          },
        ];
      },
      async listPullRequestReviews() {
        return [];
      },
    },
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async (_pool, payload) => {
      calls.closed.push(payload);
      return 0;
    },
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repositoryFullName: "croft-eng/croft",
    upsertOpenPullRequestReviewStateFn: async (_pool, record) => {
      calls.upserted.push(record);
      return record;
    },
  });

  assert.equal(calls.upserted.length, 0);
  assert.equal(calls.closed.length, 1);
  assert.deepEqual(calls.closed[0].openPrNumbers, []);
});
