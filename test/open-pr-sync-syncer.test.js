const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDefaultOpenPullRequestSyncer,
  OpenPullRequestSyncer,
  REVIEW_SYNC_TASK_NAME,
  UNTESTED_SYNC_TASK_NAME,
} = require("../src/background_jobs/syncer");

test("OpenPullRequestSyncer runs separated review and untested tasks", async () => {
  const calls = [];

  const syncer = new OpenPullRequestSyncer({
    tasks: [
      {
        name: "reviewSync",
        async run() {
          calls.push("reviewSync");
          return {
            closedCount: 2,
            openPullRequestCount: 3,
            upsertedCount: 3,
          };
        },
      },
      {
        name: "untestedSync",
        async run() {
          calls.push("untestedSync");
          return {
            mergedPullRequestCount: 4,
            upsertedCount: 1,
          };
        },
      },
    ],
  });

  const result = await syncer.sync({});

  assert.deepEqual(calls, ["reviewSync", "untestedSync"]);
  assert.equal(result[REVIEW_SYNC_TASK_NAME].upsertedCount, 3);
  assert.equal(result[REVIEW_SYNC_TASK_NAME].closedCount, 2);
  assert.equal(result[UNTESTED_SYNC_TASK_NAME].upsertedCount, 1);
  assert.equal(result[REVIEW_SYNC_TASK_NAME].openPullRequestCount, 3);
  assert.equal(result[UNTESTED_SYNC_TASK_NAME].mergedPullRequestCount, 4);
});

test("createDefaultOpenPullRequestSyncer accepts additional tasks", async () => {
  let customTaskRan = false;

  const syncer = createDefaultOpenPullRequestSyncer({
    additionalTasks: [
      {
        name: "customSync",
        async run() {
          customTaskRan = true;
          return { ok: true };
        },
      },
    ],
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    markStaleOpenPullRequestsClosedFn: async () => 0,
    upsertOpenPullRequestReviewStateFn: async () => null,
    upsertPullRequestAsUntestedFromSyncFn: async () => null,
  });

  await syncer.sync({
    codeHostClient: {
      async listOpenPullRequests() {
        return [];
      },
      async listPullRequestReviews() {
        return [];
      },
      async listClosedPullRequests() {
        return [];
      },
    },
    mainBranch: "main",
    nowFn: () => new Date("2026-02-16T12:00:00.000Z"),
    pool: {},
    repository: "croft-eng/croft",
  });

  assert.equal(customTaskRan, true);
});
