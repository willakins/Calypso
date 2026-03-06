const {
  ENVIRONMENT_STATUS_STATES,
  getEnvironmentStatusConfig,
  markEnvironmentStatusNotificationSent,
  recordEnvironmentStatusObservation,
} = require("../db");

const DEFAULT_TICK_INTERVAL_MS = 60_000;

function startEnvironmentStatusScheduler(options = {}) {
  const {
    communicationClient,
    environmentStatusTimeoutMs = 10_000,
    fetchFn = fetch,
    getEnvironmentStatusConfigFn = getEnvironmentStatusConfig,
    logger = console,
    markEnvironmentStatusNotificationSentFn = markEnvironmentStatusNotificationSent,
    nowFn = () => new Date(),
    pool,
    recordEnvironmentStatusObservationFn = recordEnvironmentStatusObservation,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  } = options;

  if (!pool || !communicationClient || typeof communicationClient.postChannelMessage !== "function") {
    logger.warn("Environment status scheduler disabled: missing pool or communication client.");
    return {
      stop() {},
    };
  }

  const schedulerState = {
    lastSkipLogMinuteKeyByReason: new Map(),
  };

  async function tick() {
    await runEnvironmentStatusSchedulerTick({
      communicationClient,
      environmentStatusTimeoutMs,
      fetchFn,
      getEnvironmentStatusConfigFn,
      logger,
      markEnvironmentStatusNotificationSentFn,
      nowFn,
      pool,
      recordEnvironmentStatusObservationFn,
      schedulerState,
    });
  }

  void tick();
  const intervalId = setInterval(() => {
    void tick();
  }, tickIntervalMs);

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}

async function runEnvironmentStatusSchedulerTick({
  communicationClient,
  environmentStatusTimeoutMs,
  fetchFn,
  getEnvironmentStatusConfigFn,
  logger,
  markEnvironmentStatusNotificationSentFn,
  nowFn,
  pool,
  recordEnvironmentStatusObservationFn,
  schedulerState,
}) {
  try {
    const now = nowFn();
    const config = await getEnvironmentStatusConfigFn(pool);
    if (!config.enabled) {
      logSchedulerSkip({ logger, now, reason: "disabled", schedulerState });
      return;
    }
    if (!config.targetUrl) {
      logSchedulerSkip({ logger, now, reason: "missing_target_url", schedulerState });
      return;
    }
    if (!config.targetChannelId) {
      logSchedulerSkip({ logger, now, reason: "missing_target_channel", schedulerState });
      return;
    }

    const checkResult = await fetchEnvironmentStatus({
      fetchFn,
      targetUrl: config.targetUrl,
      timeoutMs: environmentStatusTimeoutMs,
    });

    const observedAt = now.toISOString();
    const nextState = checkResult.state;
    const stateChanged =
      String(config.lastObservedState || ENVIRONMENT_STATUS_STATES.unknown) !== nextState;
    await recordEnvironmentStatusObservationFn(pool, {
      lastObservedState: nextState,
      lastStateChangedAt: stateChanged ? observedAt : null,
      lastCheckedAt: observedAt,
      lastHttpStatus: checkResult.httpStatus,
      lastErrorMessage: checkResult.errorMessage,
    });

    const notificationMessage = buildEnvironmentStatusNotification({
      config,
      checkResult,
    });
    if (!notificationMessage) {
      return;
    }

    await communicationClient.postChannelMessage({
      channelId: config.targetChannelId,
      mrkdwn: true,
      text: notificationMessage,
    });
    await markEnvironmentStatusNotificationSentFn(pool, nextState, observedAt);
  } catch (error) {
    logger.error("Environment status scheduler tick failed.");
    logger.error(error.message);
  }
}

async function fetchEnvironmentStatus({ fetchFn, targetUrl, timeoutMs }) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
    });

    if (response.status === 200) {
      return {
        state: ENVIRONMENT_STATUS_STATES.healthy,
        httpStatus: 200,
        errorMessage: null,
      };
    }

    return {
      state: ENVIRONMENT_STATUS_STATES.unhealthy,
      httpStatus: response.status,
      errorMessage: null,
    };
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return {
      state: ENVIRONMENT_STATUS_STATES.unhealthy,
      httpStatus: null,
      errorMessage: isTimeout ? "timeout" : String(error?.message || "network error"),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildEnvironmentStatusNotification({ config, checkResult }) {
  if (
    checkResult.state === ENVIRONMENT_STATUS_STATES.unhealthy &&
    config.lastNotifiedState !== ENVIRONMENT_STATUS_STATES.unhealthy
  ) {
    return `Environment alert: ${config.targetUrl} is down. Expected HTTP 200, got ${formatFailureDetail(checkResult)}.`;
  }

  if (
    checkResult.state === ENVIRONMENT_STATUS_STATES.healthy &&
    config.lastNotifiedState === ENVIRONMENT_STATUS_STATES.unhealthy
  ) {
    return `Environment recovery: ${config.targetUrl} returned HTTP 200 again.`;
  }

  return null;
}

function formatFailureDetail(checkResult) {
  if (Number.isInteger(checkResult.httpStatus)) {
    return `HTTP ${checkResult.httpStatus}`;
  }

  const normalizedErrorMessage = String(checkResult.errorMessage || "").trim();
  return normalizedErrorMessage || "network error";
}

function logSchedulerSkip({ logger, now, reason, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastSkipLogMinuteKeyByReason.get(reason) === minuteKey) {
    return;
  }

  schedulerState.lastSkipLogMinuteKeyByReason.set(reason, minuteKey);
  if (reason === "disabled") {
    logger.info("Environment status scheduler skipped: monitoring disabled.");
    return;
  }
  if (reason === "missing_target_url") {
    logger.info("Environment status scheduler skipped: no target URL configured.");
    return;
  }

  logger.info("Environment status scheduler skipped: no target channel configured.");
}

module.exports = {
  fetchEnvironmentStatus,
  runEnvironmentStatusSchedulerTick,
  startEnvironmentStatusScheduler,
};
