const { lookup } = require("node:dns/promises");

const { ENVIRONMENT_STATUS_STATES } = require("../../db");

const ENVIRONMENT_CHECK_OUTCOMES = Object.freeze({
  healthy: ENVIRONMENT_STATUS_STATES.healthy,
  unhealthy: ENVIRONMENT_STATUS_STATES.unhealthy,
  observerUnreachable: "observer_unreachable",
});

const ENVIRONMENT_CONNECTIVITY_STATES = Object.freeze({
  unknown: "unknown",
  reachable: "reachable",
  unreachable: "unreachable",
});

const DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 5_000;
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 3;
const DEFAULT_RETRY_MAX_DELAY_MS = 45_000;

async function runEnvironmentStatusCheckCycle(options = {}) {
  const {
    connectivityProbeTimeoutMs = DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS,
    connectivityProbeUrl,
    dnsLookupFn = lookup,
    environmentStatusTimeoutMs = 60_000,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    fetchFn = fetch,
    logger = console,
    nowFn = () => new Date(),
    retryBackoffMultiplier = DEFAULT_RETRY_BACKOFF_MULTIPLIER,
    retryInitialDelayMs = DEFAULT_RETRY_INITIAL_DELAY_MS,
    retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    sleepFn = waitForDuration,
    targetUrl,
  } = options;

  const normalizedFailureThreshold = normalizePositiveInteger(
    failureThreshold,
    DEFAULT_FAILURE_THRESHOLD,
  );
  const normalizedRetryInitialDelayMs = normalizePositiveInteger(
    retryInitialDelayMs,
    DEFAULT_RETRY_INITIAL_DELAY_MS,
  );
  const normalizedRetryBackoffMultiplier = normalizePositiveInteger(
    retryBackoffMultiplier,
    DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  );
  const normalizedRetryMaxDelayMs = normalizePositiveInteger(
    retryMaxDelayMs,
    DEFAULT_RETRY_MAX_DELAY_MS,
  );
  const normalizedConnectivityProbeTimeoutMs = normalizePositiveInteger(
    connectivityProbeTimeoutMs,
    DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS,
  );
  const normalizedEnvironmentStatusTimeoutMs = normalizePositiveInteger(
    environmentStatusTimeoutMs,
    60_000,
  );

  let lastConnectivityResult = null;
  let lastAppResult = null;
  let appAttemptCount = 0;

  for (let attemptNumber = 1; attemptNumber <= normalizedFailureThreshold; attemptNumber += 1) {
    lastConnectivityResult = await checkObserverConnectivity({
      connectivityProbeTimeoutMs: normalizedConnectivityProbeTimeoutMs,
      connectivityProbeUrl,
      dnsLookupFn,
      fetchFn,
      nowFn,
    });

    if (!lastConnectivityResult.ok) {
      logger.warn(
        `Environment status observer connectivity failed: ${lastConnectivityResult.failureCategory}.`,
      );
      return {
        outcome: ENVIRONMENT_CHECK_OUTCOMES.observerUnreachable,
        observedAt: nowFn().toISOString(),
        appAttemptCount,
        app: null,
        consecutiveFailureCount: null,
        connectivity: lastConnectivityResult,
      };
    }

    appAttemptCount = attemptNumber;
    lastAppResult = await fetchEnvironmentStatus({
      fetchFn,
      targetUrl,
      timeoutMs: normalizedEnvironmentStatusTimeoutMs,
    });

    if (lastAppResult.state === ENVIRONMENT_STATUS_STATES.healthy) {
      return {
        outcome: ENVIRONMENT_CHECK_OUTCOMES.healthy,
        observedAt: nowFn().toISOString(),
        appAttemptCount,
        app: lastAppResult,
        consecutiveFailureCount: 0,
        connectivity: lastConnectivityResult,
      };
    }

    logger.warn(
      `Environment status app probe failed: ${lastAppResult.failureCategory} (attempt ${attemptNumber}/${normalizedFailureThreshold}).`,
    );
    if (attemptNumber >= normalizedFailureThreshold) {
      break;
    }

    const retryDelayMs = buildEnvironmentStatusRetryDelayMs({
      attemptNumber,
      initialDelayMs: normalizedRetryInitialDelayMs,
      backoffMultiplier: normalizedRetryBackoffMultiplier,
      maxDelayMs: normalizedRetryMaxDelayMs,
    });
    await sleepFn(retryDelayMs);
  }

  return {
    outcome: ENVIRONMENT_CHECK_OUTCOMES.unhealthy,
    observedAt: nowFn().toISOString(),
    appAttemptCount,
    app: lastAppResult,
    consecutiveFailureCount: appAttemptCount,
    connectivity: lastConnectivityResult,
  };
}

async function checkObserverConnectivity({
  connectivityProbeTimeoutMs,
  connectivityProbeUrl,
  dnsLookupFn,
  fetchFn,
  nowFn,
}) {
  const parsedProbeUrl = new URL(connectivityProbeUrl);

  try {
    await dnsLookupFn(parsedProbeUrl.hostname);
  } catch (_error) {
    return buildObserverConnectivityResult({
      checkedAt: nowFn().toISOString(),
      failureCategory: "dns_lookup_failed",
    });
  }

  try {
    const response = await fetchWithTimeout({
      fetchFn,
      requestUrl: connectivityProbeUrl,
      timeoutMs: connectivityProbeTimeoutMs,
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        ok: true,
        checkedAt: nowFn().toISOString(),
        errorMessage: null,
        failureCategory: null,
        httpStatus: response.status,
        state: ENVIRONMENT_CONNECTIVITY_STATES.reachable,
      };
    }

    return buildObserverConnectivityResult({
      checkedAt: nowFn().toISOString(),
      failureCategory: `probe_http_${response.status}`,
      httpStatus: response.status,
    });
  } catch (error) {
    return buildObserverConnectivityResult({
      checkedAt: nowFn().toISOString(),
      failureCategory: error?.name === "AbortError" ? "probe_timeout" : "probe_network_error",
    });
  }
}

async function fetchEnvironmentStatus({ fetchFn, targetUrl, timeoutMs }) {
  try {
    const response = await fetchWithTimeout({
      fetchFn,
      requestUrl: targetUrl,
      timeoutMs,
    });

    if (response.status === 200) {
      return {
        state: ENVIRONMENT_STATUS_STATES.healthy,
        httpStatus: 200,
        errorMessage: null,
        failureCategory: null,
      };
    }

    return {
      state: ENVIRONMENT_STATUS_STATES.unhealthy,
      httpStatus: response.status,
      errorMessage: null,
      failureCategory: `http_${response.status}`,
    };
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return {
      state: ENVIRONMENT_STATUS_STATES.unhealthy,
      httpStatus: null,
      errorMessage: isTimeout ? "timeout" : String(error?.message || "network error"),
      failureCategory: isTimeout ? "timeout" : "network_error",
    };
  }
}

function buildEnvironmentStatusRetryDelayMs({
  attemptNumber,
  initialDelayMs = DEFAULT_RETRY_INITIAL_DELAY_MS,
  backoffMultiplier = DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
}) {
  const normalizedAttemptNumber = normalizePositiveInteger(attemptNumber, 1);
  const normalizedInitialDelayMs = normalizePositiveInteger(
    initialDelayMs,
    DEFAULT_RETRY_INITIAL_DELAY_MS,
  );
  const normalizedBackoffMultiplier = normalizePositiveInteger(
    backoffMultiplier,
    DEFAULT_RETRY_BACKOFF_MULTIPLIER,
  );
  const normalizedMaxDelayMs = normalizePositiveInteger(maxDelayMs, DEFAULT_RETRY_MAX_DELAY_MS);

  const computedDelayMs =
    normalizedInitialDelayMs * normalizedBackoffMultiplier ** (normalizedAttemptNumber - 1);
  return Math.min(computedDelayMs, normalizedMaxDelayMs);
}

function buildObserverConnectivityResult({ checkedAt, failureCategory, httpStatus = null }) {
  return {
    ok: false,
    checkedAt,
    errorMessage: failureCategory,
    failureCategory,
    httpStatus,
    state: ENVIRONMENT_CONNECTIVITY_STATES.unreachable,
  };
}

async function fetchWithTimeout({ fetchFn, requestUrl, timeoutMs }) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    return await fetchFn(requestUrl, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function waitForDuration(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function normalizePositiveInteger(value, fallbackValue) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

module.exports = {
  DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS,
  ENVIRONMENT_CHECK_OUTCOMES,
  ENVIRONMENT_CONNECTIVITY_STATES,
  buildEnvironmentStatusRetryDelayMs,
  checkObserverConnectivity,
  fetchEnvironmentStatus,
  runEnvironmentStatusCheckCycle,
};
