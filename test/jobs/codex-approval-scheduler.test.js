const assert = require("node:assert/strict");
const test = require("node:test");

const {
  runCodexApprovalSyncTick,
  startCodexApprovalSyncScheduler,
} = require("../../src/background_jobs/codex_approval_scheduler");

test("runCodexApprovalSyncTick updates codex approval state when values changed", async () => {
  const calls = {
    updates: [],
  };

  const summary = await runCodexApprovalSyncTick({
    codeHostClient: {
      async isPullRequestCodexApproved({ prNumber }) {
        return prNumber === 71;
      },
    },
    listTrackedOpenPullRequestsForCodexApprovalFn: async () => [
      { repo: "croft-eng/croft", pr_number: 71, codex_approved: false },
      { repo: "croft-eng/croft", pr_number: 72, codex_approved: true },
    ],
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    pool: {},
    repository: "croft-eng/croft",
    updatePullRequestCodexApprovalFn: async (_pool, update) => {
      calls.updates.push(update);
      return {
        repo: update.repo,
        pr_number: update.prNumber,
        codex_approved: update.codexApproved,
      };
    },
  });

  assert.deepEqual(summary, {
    checkedCount: 2,
    updatedCount: 2,
    failedCount: 0,
  });
  assert.deepEqual(calls.updates, [
    {
      repo: "croft-eng/croft",
      prNumber: 71,
      codexApproved: true,
    },
    {
      repo: "croft-eng/croft",
      prNumber: 72,
      codexApproved: false,
    },
  ]);
});

test("runCodexApprovalSyncTick tracks per-pr failures and continues", async () => {
  const errorLogs = [];
  const calls = {
    updates: [],
  };

  const summary = await runCodexApprovalSyncTick({
    codeHostClient: {
      async isPullRequestCodexApproved({ prNumber }) {
        if (prNumber === 72) {
          throw new Error("forbidden");
        }
        return true;
      },
    },
    listTrackedOpenPullRequestsForCodexApprovalFn: async () => [
      { repo: "croft-eng/croft", pr_number: 71, codex_approved: false },
      { repo: "croft-eng/croft", pr_number: 72, codex_approved: false },
    ],
    logger: {
      info() {},
      error(message) {
        errorLogs.push(String(message));
      },
    },
    mainBranch: "main",
    pool: {},
    repository: "croft-eng/croft",
    updatePullRequestCodexApprovalFn: async (_pool, update) => {
      calls.updates.push(update);
      return {
        repo: update.repo,
        pr_number: update.prNumber,
        codex_approved: update.codexApproved,
      };
    },
  });

  assert.deepEqual(summary, {
    checkedCount: 2,
    updatedCount: 1,
    failedCount: 1,
  });
  assert.deepEqual(calls.updates, [
    {
      repo: "croft-eng/croft",
      prNumber: 71,
      codexApproved: true,
    },
  ]);
  assert.equal(
    errorLogs.some((message) => /Codex approval sync failed for croft-eng\/croft#72/.test(message)),
    true,
  );
});

test("runCodexApprovalSyncTick stops early on token permission errors", async () => {
  const errorLogs = [];
  let calls = 0;

  const summary = await runCodexApprovalSyncTick({
    codeHostClient: {
      async isPullRequestCodexApproved() {
        calls += 1;
        throw new Error(
          "GitHub API request failed (403) for https://api.github.com/...: Resource not accessible by personal access token",
        );
      },
    },
    listTrackedOpenPullRequestsForCodexApprovalFn: async () => [
      { repo: "croft-eng/croft", pr_number: 71, codex_approved: false },
      { repo: "croft-eng/croft", pr_number: 72, codex_approved: false },
    ],
    logger: {
      info() {},
      error(message) {
        errorLogs.push(String(message));
      },
    },
    mainBranch: "main",
    pool: {},
    repository: "croft-eng/croft",
    updatePullRequestCodexApprovalFn: async () => null,
  });

  assert.deepEqual(summary, {
    checkedCount: 1,
    updatedCount: 0,
    failedCount: 1,
  });
  assert.equal(calls, 1);
  assert.equal(
    errorLogs.filter((message) => /missing required GitHub permissions/i.test(message)).length,
    1,
  );
});

test("startCodexApprovalSyncScheduler disables when client does not support codex lookup", async () => {
  const warnLogs = [];
  const scheduler = startCodexApprovalSyncScheduler({
    codeHostClient: {},
    logger: {
      warn(message) {
        warnLogs.push(message);
      },
      info() {},
      error() {},
    },
    mainBranch: "main",
    pool: {},
    repository: "croft-eng/croft",
    syncIntervalMs: 5 * 60 * 1000,
  });

  scheduler.stop();
  assert.equal(warnLogs.length, 1);
  assert.match(warnLogs[0], /Codex approval sync scheduler disabled/i);
});
