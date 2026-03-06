const assert = require("node:assert/strict");
const test = require("node:test");

const {
  runEnvironmentStatusSchedulerTick,
} = require("../../src/background_jobs/environment_status_scheduler");

test("runEnvironmentStatusSchedulerTick posts one down alert on first unhealthy transition", async () => {
  const state = {
    config: {
      enabled: true,
      lastNotifiedState: null,
      lastObservedState: "unknown",
      targetChannelId: "COPS",
      targetUrl: "https://example.com/healthz",
    },
  };
  const calls = {
    notifications: [],
    observations: [],
    posts: [],
  };

  await runEnvironmentStatusSchedulerTick({
    communicationClient: {
      async postChannelMessage(message) {
        calls.posts.push(message);
      },
    },
    fetchFn: async () => ({ status: 503 }),
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async (_pool, stateName) => {
      calls.notifications.push(stateName);
      state.config.lastNotifiedState = stateName;
    },
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async (_pool, observation) => {
      calls.observations.push(observation);
      state.config.lastObservedState = observation.lastObservedState;
    },
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
  });

  assert.equal(calls.posts.length, 1);
  assert.match(calls.posts[0].text, /Environment alert: https:\/\/example.com\/healthz is down/);
  assert.deepEqual(calls.notifications, ["unhealthy"]);
  assert.equal(calls.observations[0].lastObservedState, "unhealthy");
});

test("runEnvironmentStatusSchedulerTick does not repost repeated unhealthy checks", async () => {
  const state = {
    config: {
      enabled: true,
      lastNotifiedState: "unhealthy",
      lastObservedState: "unhealthy",
      targetChannelId: "COPS",
      targetUrl: "https://example.com/healthz",
    },
  };
  let postCount = 0;

  await runEnvironmentStatusSchedulerTick({
    communicationClient: {
      async postChannelMessage() {
        postCount += 1;
      },
    },
    fetchFn: async () => ({ status: 503 }),
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async () => {},
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async () => {},
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
  });

  assert.equal(postCount, 0);
});

test("runEnvironmentStatusSchedulerTick posts recovery after unhealthy state", async () => {
  const state = {
    config: {
      enabled: true,
      lastNotifiedState: "unhealthy",
      lastObservedState: "unhealthy",
      targetChannelId: "COPS",
      targetUrl: "https://example.com/healthz",
    },
  };
  const posts = [];

  await runEnvironmentStatusSchedulerTick({
    communicationClient: {
      async postChannelMessage(message) {
        posts.push(message);
      },
    },
    fetchFn: async () => ({ status: 200 }),
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async (_pool, stateName) => {
      state.config.lastNotifiedState = stateName;
    },
    nowFn: () => new Date("2026-03-06T12:05:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async (_pool, observation) => {
      state.config.lastObservedState = observation.lastObservedState;
    },
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
  });

  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Environment recovery: https:\/\/example.com\/healthz returned HTTP 200 again/);
});

test("runEnvironmentStatusSchedulerTick retries failed notifications on the next tick", async () => {
  const state = {
    config: {
      enabled: true,
      lastNotifiedState: null,
      lastObservedState: "unknown",
      targetChannelId: "COPS",
      targetUrl: "https://example.com/healthz",
    },
  };
  let postAttemptCount = 0;
  const communicationClient = {
    async postChannelMessage() {
      postAttemptCount += 1;
      if (postAttemptCount === 1) {
        throw new Error("post failed");
      }
    },
  };

  const runTick = async () =>
    runEnvironmentStatusSchedulerTick({
      communicationClient,
      fetchFn: async () => ({ status: 503 }),
      getEnvironmentStatusConfigFn: async () => state.config,
      logger: silentLogger(),
      markEnvironmentStatusNotificationSentFn: async (_pool, stateName) => {
        state.config.lastNotifiedState = stateName;
      },
      nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
      pool: {},
      recordEnvironmentStatusObservationFn: async (_pool, observation) => {
        state.config.lastObservedState = observation.lastObservedState;
      },
      schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    });

  await runTick();
  assert.equal(state.config.lastNotifiedState, null);

  await runTick();
  assert.equal(postAttemptCount, 2);
  assert.equal(state.config.lastNotifiedState, "unhealthy");
});

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}
