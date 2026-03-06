const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildErrorTrackingNotificationText,
  runErrorTrackingSchedulerTick,
  startErrorTrackingScheduler,
} = require("../../src/background_jobs/error_tracking_scheduler");

test("runErrorTrackingSchedulerTick skips when monitoring is disabled", async () => {
  const logs = [];

  await runErrorTrackingSchedulerTick({
    communicationClient: {
      async postChannelMessage() {
        throw new Error("should not post");
      },
    },
    errorTrackingClient: {
      async listUnresolvedIssues() {
        throw new Error("should not sync");
      },
    },
    getErrorTrackingConfigFn: async () => ({
      enabled: false,
      projectSlug: "api",
      targetChannelId: "COPS",
    }),
    logger: captureLogger(logs),
    pool: {},
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
  });

  assert.deepEqual(logs, ["Error tracking scheduler skipped: monitoring disabled."]);
});

test("runErrorTrackingSchedulerTick establishes baseline without posting alerts", async () => {
  const state = {
    config: {
      baselineCompletedAt: null,
      enabled: true,
      environment: "production",
      lastSyncAt: null,
      lastSyncError: null,
      projectSlug: "api",
      targetChannelId: "COPS",
    },
  };
  let syncSuppressNotifications = null;
  let postCount = 0;

  const result = await runErrorTrackingSchedulerTick({
    communicationClient: {
      async postChannelMessage() {
        postCount += 1;
      },
    },
    errorTrackingClient: {
      async listUnresolvedIssues() {
        return [
          {
            externalIssueId: "1",
            firstSeenAt: "2026-03-06T12:00:00.000Z",
            lastSeenAt: "2026-03-06T12:05:00.000Z",
            shortId: "API-1",
            title: "Unhandled exception",
          },
        ];
      },
    },
    getErrorTrackingConfigFn: async () => state.config,
    listUnnotifiedErrorTrackingIssuesFn: async () => [],
    logger: silentLogger(),
    nowFn: () => new Date("2026-03-06T12:10:00.000Z"),
    pool: transactionlessPool(),
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    syncErrorTrackingIssueSnapshotFn: async (_pool, options) => {
      syncSuppressNotifications = options.suppressNotifications;
    },
    updateErrorTrackingRuntimeStateFn: async (_pool, updates) => {
      state.config.baselineCompletedAt = updates.baselineCompletedAt || state.config.baselineCompletedAt;
      state.config.lastSyncAt = updates.lastSyncAt || state.config.lastSyncAt;
      state.config.lastSyncError = updates.clearLastSyncError ? null : updates.lastSyncError;
      return state.config;
    },
  });

  assert.equal(syncSuppressNotifications, true);
  assert.equal(postCount, 0);
  assert.equal(result.baselineApplied, true);
  assert.equal(state.config.baselineCompletedAt, "2026-03-06T12:10:00.000Z");
});

test("runErrorTrackingSchedulerTick posts new issue alerts after baseline", async () => {
  const state = {
    config: {
      baselineCompletedAt: "2026-03-06T12:00:00.000Z",
      enabled: true,
      environment: "production",
      projectSlug: "api",
      targetChannelId: "COPS",
    },
    pendingIssues: [
      {
        id: 7,
        projectSlug: "api",
        environment: "production",
        externalIssueId: "7",
        shortId: "API-7",
        title: "Database unavailable",
        level: "error",
        openedAt: "2026-03-06T12:01:00.000Z",
        lastSeenAt: "2026-03-06T12:02:00.000Z",
        regressionCount: 0,
      },
    ],
  };
  const posts = [];
  const marks = [];

  const result = await runErrorTrackingSchedulerTick({
    communicationClient: {
      async postChannelMessage(message) {
        posts.push(message);
      },
    },
    errorTrackingClient: {
      async listUnresolvedIssues() {
        return [];
      },
    },
    getErrorTrackingConfigFn: async () => state.config,
    listUnnotifiedErrorTrackingIssuesFn: async () => state.pendingIssues,
    logger: silentLogger(),
    markErrorTrackingIssueNotificationSentFn: async (_pool, issueId, notificationSentAt) => {
      marks.push({ issueId, notificationSentAt });
      state.pendingIssues = [];
    },
    nowFn: () => new Date("2026-03-06T12:10:00.000Z"),
    pool: transactionlessPool(),
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    syncErrorTrackingIssueSnapshotFn: async () => {},
    updateErrorTrackingRuntimeStateFn: async () => state.config,
  });

  assert.equal(result.postedCount, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Error alert: \[API-7\]/);
  assert.deepEqual(marks, [{
    issueId: 7,
    notificationSentAt: "2026-03-06T12:10:00.000Z",
  }]);
});

test("runErrorTrackingSchedulerTick retries failed notifications on the next tick", async () => {
  const state = {
    config: {
      baselineCompletedAt: "2026-03-06T12:00:00.000Z",
      enabled: true,
      environment: null,
      projectSlug: "api",
      targetChannelId: "COPS",
    },
    pendingIssues: [
      {
        id: 7,
        projectSlug: "api",
        environment: null,
        externalIssueId: "7",
        shortId: "API-7",
        title: "Database unavailable",
        level: "error",
        openedAt: "2026-03-06T12:01:00.000Z",
        lastSeenAt: "2026-03-06T12:02:00.000Z",
        regressionCount: 1,
      },
    ],
  };
  let postAttemptCount = 0;
  let markCount = 0;

  const runTick = async () =>
    runErrorTrackingSchedulerTick({
      communicationClient: {
        async postChannelMessage() {
          postAttemptCount += 1;
          if (postAttemptCount === 1) {
            throw new Error("post failed");
          }
        },
      },
      errorTrackingClient: {
        async listUnresolvedIssues() {
          return [];
        },
      },
      getErrorTrackingConfigFn: async () => state.config,
      listUnnotifiedErrorTrackingIssuesFn: async () => state.pendingIssues,
      logger: silentLogger(),
      markErrorTrackingIssueNotificationSentFn: async () => {
        markCount += 1;
        state.pendingIssues = [];
      },
      nowFn: () => new Date("2026-03-06T12:10:00.000Z"),
      pool: transactionlessPool(),
      schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
      syncErrorTrackingIssueSnapshotFn: async () => {},
      updateErrorTrackingRuntimeStateFn: async (_pool, updates) => {
        if (updates.lastSyncError) {
          state.config.lastSyncError = updates.lastSyncError;
        }
        if (updates.clearLastSyncError) {
          state.config.lastSyncError = null;
        }
        return state.config;
      },
    });

  await runTick();
  assert.equal(markCount, 0);
  assert.equal(state.pendingIssues.length, 1);
  assert.equal(state.config.lastSyncError, "post failed");

  await runTick();
  assert.equal(postAttemptCount, 2);
  assert.equal(markCount, 1);
  assert.equal(state.pendingIssues.length, 0);
});

test("buildErrorTrackingNotificationText labels regressions distinctly", () => {
  const text = buildErrorTrackingNotificationText({
    externalIssueId: "7",
    shortId: "API-7",
    title: "Database unavailable",
    projectSlug: "api",
    environment: "production",
    level: "error",
    openedAt: "2026-03-06T12:01:00.000Z",
    lastSeenAt: "2026-03-06T12:02:00.000Z",
    regressionCount: 2,
  });

  assert.match(text, /Error regression: \[API-7\]/);
  assert.match(text, /project `api`/);
  assert.match(text, /environment `production`/);
});

test("startErrorTrackingScheduler avoids overlapping ticks", async () => {
  let syncCount = 0;
  let releaseTick;
  const syncBlocker = new Promise((resolve) => {
    releaseTick = resolve;
  });

  const scheduler = startErrorTrackingScheduler({
    communicationClient: {
      async postChannelMessage() {},
    },
    errorTrackingClient: {
      async listUnresolvedIssues() {
        syncCount += 1;
        await syncBlocker;
        return [];
      },
    },
    getErrorTrackingConfigFn: async () => ({
      baselineCompletedAt: "2026-03-06T12:00:00.000Z",
      enabled: true,
      projectSlug: "api",
      targetChannelId: "COPS",
    }),
    listUnnotifiedErrorTrackingIssuesFn: async () => [],
    logger: silentLogger(),
    pool: transactionlessPool(),
    syncErrorTrackingIssueSnapshotFn: async () => {},
    tickIntervalMs: 5,
    updateErrorTrackingRuntimeStateFn: async () => ({}),
  });

  await wait(20);
  scheduler.stop();
  releaseTick();
  await wait(0);

  assert.equal(syncCount, 1);
});

function captureLogger(messages) {
  return {
    error() {},
    info(message) {
      messages.push(message);
    },
    warn() {},
  };
}

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}

function transactionlessPool() {
  return {
    async query() {},
  };
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
