const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ENVIRONMENT_CHECK_OUTCOMES,
  buildEnvironmentStatusRetryDelayMs,
  checkObserverConnectivity,
  fetchEnvironmentStatus,
  runEnvironmentStatusCheckCycle,
} = require("../../src/background_jobs/tasks/environment_status_check");

const CONNECTIVITY_PROBE_URL = "https://probe.example.com/healthz";
const TARGET_URL = "https://app.example.com/healthz";

test("buildEnvironmentStatusRetryDelayMs applies exponential backoff with a cap", () => {
  assert.equal(
    buildEnvironmentStatusRetryDelayMs({
      attemptNumber: 1,
      initialDelayMs: 5_000,
      backoffMultiplier: 3,
      maxDelayMs: 45_000,
    }),
    5_000,
  );
  assert.equal(
    buildEnvironmentStatusRetryDelayMs({
      attemptNumber: 2,
      initialDelayMs: 5_000,
      backoffMultiplier: 3,
      maxDelayMs: 45_000,
    }),
    15_000,
  );
  assert.equal(
    buildEnvironmentStatusRetryDelayMs({
      attemptNumber: 4,
      initialDelayMs: 5_000,
      backoffMultiplier: 3,
      maxDelayMs: 45_000,
    }),
    45_000,
  );
});

test("checkObserverConnectivity returns unreachable when dns lookup fails", async () => {
  const result = await checkObserverConnectivity({
    connectivityProbeTimeoutMs: 5_000,
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => {
      throw new Error("getaddrinfo ENOTFOUND probe.example.com");
    },
    fetchFn: async () => ({ status: 204 }),
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureCategory, "dns_lookup_failed");
  assert.equal(result.errorMessage, "dns_lookup_failed");
});

test("checkObserverConnectivity returns unreachable on probe timeout", async () => {
  const result = await checkObserverConnectivity({
    connectivityProbeTimeoutMs: 5_000,
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    fetchFn: async () => {
      throw createAbortError();
    },
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureCategory, "probe_timeout");
});

test("checkObserverConnectivity returns unreachable on probe http failure", async () => {
  const result = await checkObserverConnectivity({
    connectivityProbeTimeoutMs: 5_000,
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    fetchFn: async () => ({ status: 503 }),
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureCategory, "probe_http_503");
  assert.equal(result.httpStatus, 503);
});

test("fetchEnvironmentStatus returns unhealthy on timeout", async () => {
  const result = await fetchEnvironmentStatus({
    fetchFn: async () => {
      throw createAbortError();
    },
    targetUrl: TARGET_URL,
    timeoutMs: 60_000,
  });

  assert.equal(result.state, "unhealthy");
  assert.equal(result.failureCategory, "timeout");
  assert.equal(result.errorMessage, "timeout");
});

test("fetchEnvironmentStatus returns unhealthy on non-200 response", async () => {
  const result = await fetchEnvironmentStatus({
    fetchFn: async () => ({ status: 503 }),
    targetUrl: TARGET_URL,
    timeoutMs: 60_000,
  });

  assert.equal(result.state, "unhealthy");
  assert.equal(result.failureCategory, "http_503");
  assert.equal(result.httpStatus, 503);
});

test("runEnvironmentStatusCheckCycle retries once and returns healthy when the app recovers", async () => {
  const sleepDurations = [];
  const requests = [];
  const fetchResponsesByUrl = new Map([
    [CONNECTIVITY_PROBE_URL, [{ status: 204 }, { status: 204 }]],
    [TARGET_URL, [{ status: 503 }, { status: 200 }]],
  ]);

  const result = await runEnvironmentStatusCheckCycle({
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    failureThreshold: 3,
    fetchFn: async (requestUrl) => {
      requests.push(requestUrl);
      return fetchResponsesByUrl.get(requestUrl).shift();
    },
    logger: silentLogger(),
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    retryBackoffMultiplier: 3,
    retryInitialDelayMs: 5_000,
    retryMaxDelayMs: 45_000,
    sleepFn: async (durationMs) => {
      sleepDurations.push(durationMs);
    },
    targetUrl: TARGET_URL,
  });

  assert.equal(result.outcome, ENVIRONMENT_CHECK_OUTCOMES.healthy);
  assert.equal(result.appAttemptCount, 2);
  assert.equal(result.consecutiveFailureCount, 0);
  assert.deepEqual(sleepDurations, [5_000]);
  assert.deepEqual(requests, [
    CONNECTIVITY_PROBE_URL,
    TARGET_URL,
    CONNECTIVITY_PROBE_URL,
    TARGET_URL,
  ]);
});

test("runEnvironmentStatusCheckCycle confirms an outage after three failed app probes", async () => {
  const sleepDurations = [];

  const result = await runEnvironmentStatusCheckCycle({
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    failureThreshold: 3,
    fetchFn: async (requestUrl) => {
      if (requestUrl === CONNECTIVITY_PROBE_URL) {
        return { status: 204 };
      }
      return { status: 503 };
    },
    logger: silentLogger(),
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    retryBackoffMultiplier: 3,
    retryInitialDelayMs: 5_000,
    retryMaxDelayMs: 45_000,
    sleepFn: async (durationMs) => {
      sleepDurations.push(durationMs);
    },
    targetUrl: TARGET_URL,
  });

  assert.equal(result.outcome, ENVIRONMENT_CHECK_OUTCOMES.unhealthy);
  assert.equal(result.appAttemptCount, 3);
  assert.equal(result.consecutiveFailureCount, 3);
  assert.equal(result.app.failureCategory, "http_503");
  assert.deepEqual(sleepDurations, [5_000, 15_000]);
});

test("runEnvironmentStatusCheckCycle aborts the retry burst when observer connectivity is lost", async () => {
  let connectivityAttemptCount = 0;
  let appFetchCount = 0;

  const result = await runEnvironmentStatusCheckCycle({
    connectivityProbeUrl: CONNECTIVITY_PROBE_URL,
    dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
    failureThreshold: 3,
    fetchFn: async (requestUrl) => {
      if (requestUrl === CONNECTIVITY_PROBE_URL) {
        connectivityAttemptCount += 1;
        if (connectivityAttemptCount === 2) {
          throw createAbortError();
        }
        return { status: 204 };
      }

      appFetchCount += 1;
      return { status: 503 };
    },
    logger: silentLogger(),
    nowFn: () => new Date("2026-03-08T12:00:00.000Z"),
    sleepFn: async () => {},
    targetUrl: TARGET_URL,
  });

  assert.equal(result.outcome, ENVIRONMENT_CHECK_OUTCOMES.observerUnreachable);
  assert.equal(result.appAttemptCount, 1);
  assert.equal(result.connectivity.failureCategory, "probe_timeout");
  assert.equal(appFetchCount, 1);
});

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}
