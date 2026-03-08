const assert = require("node:assert/strict");
const test = require("node:test");

const {
  runEnvironmentStatusSchedulerTick,
  startEnvironmentStatusScheduler,
} = require("../../src/background_jobs/environment_status_scheduler");

const CONNECTIVITY_PROBE_URL = "https://probe.example.com/healthz";
const TARGET_URL = "https://example.com/healthz";

test("runEnvironmentStatusSchedulerTick does not alert when a retry succeeds within the same cycle", async () => {
  const state = {
    config: createEnvironmentStatusConfig(),
  };
  const calls = {
    posts: [],
    sleepDurations: [],
  };
  let appAttemptCount = 0;

  await runEnvironmentStatusSchedulerTick({
    communicationClient: createCommunicationClient(calls.posts),
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    environmentStatusFailureThreshold: 3,
    environmentStatusRetryBackoffMultiplier: 3,
    environmentStatusRetryInitialDelayMs: 5_000,
    environmentStatusRetryMaxDelayMs: 45_000,
    environmentStatusTimeoutMs: 60_000,
    fetchFn: async (requestUrl) => {
      if (requestUrl === CONNECTIVITY_PROBE_URL) {
        return { status: 204 };
      }

      appAttemptCount += 1;
      return { status: appAttemptCount === 1 ? 503 : 200 };
    },
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async (_pool, stateName, notifiedAt) => {
      state.config.lastNotifiedState = stateName;
      state.config.lastNotifiedAt = notifiedAt;
    },
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async (_pool, observation) => {
      applyEnvironmentStatusObservation(state.config, observation);
    },
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    sleepFn: async (durationMs) => {
      calls.sleepDurations.push(durationMs);
    },
    updateEnvironmentStatusRuntimeStateFn: async (_pool, updates) => {
      applyEnvironmentStatusRuntimeUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(calls.posts.length, 0);
  assert.equal(state.config.lastObservedState, "healthy");
  assert.equal(state.config.consecutiveFailureCount, 0);
  assert.equal(state.config.lastHttpStatus, 200);
  assert.equal(state.config.lastConnectivityState, "reachable");
  assert.deepEqual(calls.sleepDurations, [5_000]);
});

test("runEnvironmentStatusSchedulerTick posts one down alert after three confirmed failures", async () => {
  const state = {
    config: createEnvironmentStatusConfig(),
  };
  const calls = {
    notifications: [],
    observations: [],
    posts: [],
    runtimeUpdates: [],
    sleepDurations: [],
  };

  await runEnvironmentStatusSchedulerTick({
    communicationClient: createCommunicationClient(calls.posts),
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    environmentStatusFailureThreshold: 3,
    environmentStatusRetryBackoffMultiplier: 3,
    environmentStatusRetryInitialDelayMs: 5_000,
    environmentStatusRetryMaxDelayMs: 45_000,
    environmentStatusTimeoutMs: 60_000,
    fetchFn: async (requestUrl) => {
      if (requestUrl === CONNECTIVITY_PROBE_URL) {
        return { status: 204 };
      }
      return { status: 503 };
    },
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async (_pool, stateName, notifiedAt) => {
      calls.notifications.push(stateName);
      state.config.lastNotifiedState = stateName;
      state.config.lastNotifiedAt = notifiedAt;
    },
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async (_pool, observation) => {
      calls.observations.push(observation);
      applyEnvironmentStatusObservation(state.config, observation);
    },
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    sleepFn: async (durationMs) => {
      calls.sleepDurations.push(durationMs);
    },
    updateEnvironmentStatusRuntimeStateFn: async (_pool, updates) => {
      calls.runtimeUpdates.push(updates);
      applyEnvironmentStatusRuntimeUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(calls.posts.length, 1);
  assert.match(calls.posts[0].text, /down after 3 consecutive failed checks/);
  assert.match(calls.posts[0].text, /HTTP 503/);
  assert.deepEqual(calls.notifications, ["unhealthy"]);
  assert.equal(calls.observations[0].lastObservedState, "unhealthy");
  assert.equal(calls.observations[0].consecutiveFailureCount, 3);
  assert.equal(calls.runtimeUpdates[0].lastConnectivityState, "reachable");
  assert.equal(calls.runtimeUpdates[0].clearLastConnectivityErrorMessage, true);
  assert.deepEqual(calls.sleepDurations, [5_000, 15_000]);
});

test("runEnvironmentStatusSchedulerTick does not repost repeated unhealthy checks", async () => {
  const state = {
    config: createEnvironmentStatusConfig({
      lastNotifiedState: "unhealthy",
      lastObservedState: "unhealthy",
    }),
  };
  let postCount = 0;

  await runEnvironmentStatusSchedulerTick({
    communicationClient: {
      async postChannelMessage() {
        postCount += 1;
      },
    },
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async () => {},
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async () => {},
    runEnvironmentStatusCheckCycleFn: async () => ({
      outcome: "unhealthy",
      observedAt: "2026-03-08T12:00:00.000Z",
      appAttemptCount: 3,
      app: { errorMessage: null, httpStatus: 503 },
      consecutiveFailureCount: 3,
      connectivity: { checkedAt: "2026-03-08T12:00:00.000Z" },
    }),
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    updateEnvironmentStatusRuntimeStateFn: async () => ({}),
  });

  assert.equal(postCount, 0);
});

test("runEnvironmentStatusSchedulerTick posts recovery after an unhealthy state", async () => {
  const state = {
    config: createEnvironmentStatusConfig({
      lastNotifiedState: "unhealthy",
      lastObservedState: "unhealthy",
    }),
  };
  const posts = [];

  await runEnvironmentStatusSchedulerTick({
    communicationClient: createCommunicationClient(posts),
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async (_pool, stateName) => {
      state.config.lastNotifiedState = stateName;
    },
    nowFn: () => new Date("2026-03-08T12:05:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async (_pool, observation) => {
      applyEnvironmentStatusObservation(state.config, observation);
    },
    runEnvironmentStatusCheckCycleFn: async () => ({
      outcome: "healthy",
      observedAt: "2026-03-08T12:05:00.000Z",
      appAttemptCount: 1,
      app: { errorMessage: null, httpStatus: 200 },
      consecutiveFailureCount: 0,
      connectivity: { checkedAt: "2026-03-08T12:05:00.000Z" },
    }),
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    updateEnvironmentStatusRuntimeStateFn: async () => ({}),
  });

  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Environment recovery: https:\/\/example.com\/healthz returned HTTP 200 again/);
});

test("runEnvironmentStatusSchedulerTick retries failed notifications on the next tick", async () => {
  const state = {
    config: createEnvironmentStatusConfig(),
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
      connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
      getEnvironmentStatusConfigFn: async () => state.config,
      logger: silentLogger(),
      markEnvironmentStatusNotificationSentFn: async (_pool, stateName) => {
        state.config.lastNotifiedState = stateName;
      },
      nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
      pool: {},
      recordEnvironmentStatusObservationFn: async (_pool, observation) => {
        applyEnvironmentStatusObservation(state.config, observation);
      },
      runEnvironmentStatusCheckCycleFn: async () => ({
        outcome: "unhealthy",
        observedAt: "2026-03-08T12:00:00.000Z",
        appAttemptCount: 3,
        app: { errorMessage: null, httpStatus: 503 },
        consecutiveFailureCount: 3,
        connectivity: { checkedAt: "2026-03-08T12:00:00.000Z" },
      }),
      schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
      updateEnvironmentStatusRuntimeStateFn: async () => ({}),
    });

  await runTick();
  assert.equal(state.config.lastNotifiedState, null);

  await runTick();
  assert.equal(postAttemptCount, 2);
  assert.equal(state.config.lastNotifiedState, "unhealthy");
});

test("runEnvironmentStatusSchedulerTick does not mark the app down when observer connectivity is lost", async () => {
  const state = {
    config: createEnvironmentStatusConfig({
      lastObservedState: "healthy",
      lastNotifiedState: "healthy",
    }),
  };
  const calls = {
    posts: [],
    observations: 0,
    runtimeUpdates: [],
  };

  await runEnvironmentStatusSchedulerTick({
    communicationClient: createCommunicationClient(calls.posts),
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    getEnvironmentStatusConfigFn: async () => state.config,
    logger: silentLogger(),
    markEnvironmentStatusNotificationSentFn: async () => {},
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async () => {
      calls.observations += 1;
    },
    runEnvironmentStatusCheckCycleFn: async () => ({
      outcome: "observer_unreachable",
      observedAt: "2026-03-08T12:00:00.000Z",
      appAttemptCount: 1,
      app: null,
      consecutiveFailureCount: null,
      connectivity: {
        checkedAt: "2026-03-08T12:00:00.000Z",
        errorMessage: "probe_timeout",
      },
    }),
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    updateEnvironmentStatusRuntimeStateFn: async (_pool, updates) => {
      calls.runtimeUpdates.push(updates);
      applyEnvironmentStatusRuntimeUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(calls.posts.length, 0);
  assert.equal(calls.observations, 0);
  assert.equal(state.config.lastObservedState, "healthy");
  assert.equal(state.config.lastConnectivityState, "unreachable");
  assert.equal(state.config.lastConnectivityErrorMessage, "probe_timeout");
  assert.equal(calls.runtimeUpdates.length, 1);
});

test("runEnvironmentStatusSchedulerTick skips when no connectivity probe url is configured", async () => {
  const logs = [];
  let checkCount = 0;

  await runEnvironmentStatusSchedulerTick({
    communicationClient: createCommunicationClient([]),
    connectivityProbeUrl: "",
    getEnvironmentStatusConfigFn: async () => createEnvironmentStatusConfig(),
    logger: captureLogger(logs),
    markEnvironmentStatusNotificationSentFn: async () => {},
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    pool: {},
    recordEnvironmentStatusObservationFn: async () => {},
    runEnvironmentStatusCheckCycleFn: async () => {
      checkCount += 1;
    },
    schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
    updateEnvironmentStatusRuntimeStateFn: async () => ({}),
  });

  assert.equal(checkCount, 0);
  assert.deepEqual(logs, ["Environment status scheduler skipped: no connectivity probe URL configured."]);
});

test("startEnvironmentStatusScheduler avoids overlapping ticks", async () => {
  let checkCount = 0;
  let releaseTick;
  const tickBlocker = new Promise((resolve) => {
    releaseTick = resolve;
  });

  const scheduler = startEnvironmentStatusScheduler({
    communicationClient: {
      async postChannelMessage() {},
    },
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    getEnvironmentStatusConfigFn: async () => createEnvironmentStatusConfig(),
    logger: silentLogger(),
    pool: {},
    recordEnvironmentStatusObservationFn: async () => {},
    runEnvironmentStatusCheckCycleFn: async () => {
      checkCount += 1;
      await tickBlocker;
      return {
        outcome: "healthy",
        observedAt: "2026-03-08T12:00:00.000Z",
        appAttemptCount: 1,
        app: { errorMessage: null, httpStatus: 200 },
        consecutiveFailureCount: 0,
        connectivity: { checkedAt: "2026-03-08T12:00:00.000Z" },
      };
    },
    tickIntervalMs: 5,
    updateEnvironmentStatusRuntimeStateFn: async () => ({}),
  });

  await wait(20);
  scheduler.stop();
  releaseTick();
  await wait(0);

  assert.equal(checkCount, 1);
});

function createCommunicationClient(posts) {
  return {
    async postChannelMessage(message) {
      posts.push(message);
    },
  };
}

function createEnvironmentStatusConfig(overrides = {}) {
  return {
    enabled: true,
    consecutiveFailureCount: 0,
    lastCheckedAt: null,
    lastConnectivityCheckedAt: null,
    lastConnectivityErrorMessage: null,
    lastConnectivityState: "unknown",
    lastErrorMessage: null,
    lastHttpStatus: null,
    lastNotifiedAt: null,
    lastNotifiedState: null,
    lastObservedState: "unknown",
    lastStateChangedAt: null,
    targetChannelId: "COPS",
    targetUrl: TARGET_URL,
    ...overrides,
  };
}

function applyEnvironmentStatusObservation(config, observation) {
  config.lastObservedState = observation.lastObservedState;
  config.lastStateChangedAt = observation.lastStateChangedAt || config.lastStateChangedAt;
  config.lastCheckedAt = observation.lastCheckedAt;
  config.lastHttpStatus = observation.lastHttpStatus ?? null;
  config.lastErrorMessage = observation.lastErrorMessage ?? null;
  if (observation.consecutiveFailureCount !== undefined) {
    config.consecutiveFailureCount = observation.consecutiveFailureCount;
  }
}

function applyEnvironmentStatusRuntimeUpdates(config, updates) {
  if (updates.lastConnectivityState !== undefined && updates.lastConnectivityState !== null) {
    config.lastConnectivityState = updates.lastConnectivityState;
  }
  if (updates.lastConnectivityCheckedAt !== undefined) {
    config.lastConnectivityCheckedAt = updates.lastConnectivityCheckedAt;
  }
  if (updates.lastConnectivityErrorMessage !== undefined) {
    config.lastConnectivityErrorMessage = updates.lastConnectivityErrorMessage;
  }
  if (updates.clearLastConnectivityErrorMessage) {
    config.lastConnectivityErrorMessage = null;
  }
}

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

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
