const {
  ENVIRONMENT_CONNECTIVITY_STATES,
  ENVIRONMENT_STATUS_STATES,
  getEnvironmentStatusConfig,
  markEnvironmentStatusNotificationSent,
  recordEnvironmentStatusObservation,
  updateEnvironmentStatusRuntimeState,
} = require("../db");
const {
  runEnvironmentStatusCheckCycle,
} = require("./tasks/environment_status_check");

const DEFAULT_TICK_INTERVAL_MS = 60_000;

function startEnvironmentStatusScheduler(options = {}) {
  const {
    communicationClient,
    connectivityProbeUrl = "",
    dnsLookupFn,
    environmentStatusFailureThreshold = 3,
    environmentStatusRetryBackoffMultiplier = 3,
    environmentStatusRetryInitialDelayMs = 5_000,
    environmentStatusRetryMaxDelayMs = 45_000,
    environmentStatusTimeoutMs = 60_000,
    fetchFn = fetch,
    getEnvironmentStatusConfigFn = getEnvironmentStatusConfig,
    logger = console,
    markEnvironmentStatusNotificationSentFn = markEnvironmentStatusNotificationSent,
    nowFn = () => new Date(),
    pool,
    recordEnvironmentStatusObservationFn = recordEnvironmentStatusObservation,
    runEnvironmentStatusCheckCycleFn = runEnvironmentStatusCheckCycle,
    schedulerState = null,
    sleepFn,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    updateEnvironmentStatusRuntimeStateFn = updateEnvironmentStatusRuntimeState,
  } = options;

  if (!pool || !communicationClient || typeof communicationClient.postChannelMessage !== "function") {
    logger.warn("Environment status scheduler disabled: missing pool or communication client.");
    return {
      stop() {},
    };
  }

  const resolvedSchedulerState = schedulerState || {
    inFlight: false,
    lastSkipLogMinuteKeyByReason: new Map(),
  };

  async function tick() {
    if (resolvedSchedulerState.inFlight) {
      return;
    }

    resolvedSchedulerState.inFlight = true;
    try {
      await runEnvironmentStatusSchedulerTick({
        communicationClient,
        connectivityProbeUrl,
        dnsLookupFn,
        environmentStatusFailureThreshold,
        environmentStatusRetryBackoffMultiplier,
        environmentStatusRetryInitialDelayMs,
        environmentStatusRetryMaxDelayMs,
        environmentStatusTimeoutMs,
        fetchFn,
        getEnvironmentStatusConfigFn,
        logger,
        markEnvironmentStatusNotificationSentFn,
        nowFn,
        pool,
        recordEnvironmentStatusObservationFn,
        runEnvironmentStatusCheckCycleFn,
        schedulerState: resolvedSchedulerState,
        sleepFn,
        updateEnvironmentStatusRuntimeStateFn,
      });
    } finally {
      resolvedSchedulerState.inFlight = false;
    }
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
  connectivityProbeUrl,
  dnsLookupFn,
  environmentStatusFailureThreshold,
  environmentStatusRetryBackoffMultiplier,
  environmentStatusRetryInitialDelayMs,
  environmentStatusRetryMaxDelayMs,
  environmentStatusTimeoutMs,
  fetchFn,
  getEnvironmentStatusConfigFn,
  logger,
  markEnvironmentStatusNotificationSentFn,
  nowFn,
  pool,
  recordEnvironmentStatusObservationFn,
  runEnvironmentStatusCheckCycleFn = runEnvironmentStatusCheckCycle,
  schedulerState,
  sleepFn,
  updateEnvironmentStatusRuntimeStateFn = updateEnvironmentStatusRuntimeState,
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
    if (!String(connectivityProbeUrl || "").trim()) {
      logSchedulerSkip({ logger, now, reason: "missing_connectivity_probe_url", schedulerState });
      return;
    }

    const checkResult = await runEnvironmentStatusCheckCycleFn({
      connectivityProbeUrl,
      dnsLookupFn,
      environmentStatusTimeoutMs,
      failureThreshold: environmentStatusFailureThreshold,
      fetchFn,
      logger,
      nowFn,
      retryBackoffMultiplier: environmentStatusRetryBackoffMultiplier,
      retryInitialDelayMs: environmentStatusRetryInitialDelayMs,
      retryMaxDelayMs: environmentStatusRetryMaxDelayMs,
      sleepFn,
      targetUrl: config.targetUrl,
    });

    if (checkResult.outcome === "observer_unreachable") {
      await updateEnvironmentStatusRuntimeStateFn(pool, {
        lastConnectivityState: ENVIRONMENT_CONNECTIVITY_STATES.unreachable,
        lastConnectivityCheckedAt: checkResult.connectivity.checkedAt,
        lastConnectivityErrorMessage: checkResult.connectivity.errorMessage,
      });
      return;
    }

    const observedAt = checkResult.observedAt;
    const nextState = checkResult.outcome;
    const stateChanged =
      String(config.lastObservedState || ENVIRONMENT_STATUS_STATES.unknown) !== nextState;
    await recordEnvironmentStatusObservationFn(pool, {
      lastObservedState: nextState,
      lastStateChangedAt: stateChanged ? observedAt : null,
      lastCheckedAt: observedAt,
      lastHttpStatus: checkResult.app.httpStatus,
      lastErrorMessage: checkResult.app.errorMessage,
      consecutiveFailureCount: checkResult.consecutiveFailureCount,
    });
    await updateEnvironmentStatusRuntimeStateFn(pool, {
      lastConnectivityState: ENVIRONMENT_CONNECTIVITY_STATES.reachable,
      lastConnectivityCheckedAt: checkResult.connectivity.checkedAt,
      clearLastConnectivityErrorMessage: true,
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

function buildEnvironmentStatusNotification({ config, checkResult }) {
  if (
    checkResult.outcome === ENVIRONMENT_STATUS_STATES.unhealthy &&
    config.lastNotifiedState !== ENVIRONMENT_STATUS_STATES.unhealthy
  ) {
    return [
      `Environment alert: ${config.targetUrl} is down after ${checkResult.appAttemptCount} consecutive failed checks.`,
      `Expected HTTP 200, got ${formatFailureDetail(checkResult.app)}.`,
    ].join(" ");
  }

  if (
    checkResult.outcome === ENVIRONMENT_STATUS_STATES.healthy &&
    config.lastNotifiedState === ENVIRONMENT_STATUS_STATES.unhealthy
  ) {
    return `Environment recovery: ${config.targetUrl} returned HTTP 200 again.`;
  }

  return null;
}

function formatFailureDetail(checkResult) {
  if (Number.isInteger(checkResult?.httpStatus)) {
    return `HTTP ${checkResult.httpStatus}`;
  }

  const normalizedErrorMessage = String(checkResult?.errorMessage || "").trim();
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
  if (reason === "missing_target_channel") {
    logger.info("Environment status scheduler skipped: no target channel configured.");
    return;
  }

  logger.info("Environment status scheduler skipped: no connectivity probe URL configured.");
}

module.exports = {
  buildEnvironmentStatusNotification,
  runEnvironmentStatusSchedulerTick,
  startEnvironmentStatusScheduler,
};
