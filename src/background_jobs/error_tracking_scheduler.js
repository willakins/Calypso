const {
  getErrorTrackingConfig,
  listUnnotifiedErrorTrackingIssues,
  markErrorTrackingIssueNotificationSent,
  syncErrorTrackingIssueSnapshot,
  updateErrorTrackingRuntimeState,
} = require("../db");

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000;

function startErrorTrackingScheduler(options = {}) {
  const {
    communicationClient = null,
    errorTrackingClient = null,
    errorTrackingProvider = "sentry",
    errorTrackingTimeoutMs = 15_000,
    getErrorTrackingConfigFn = getErrorTrackingConfig,
    listUnnotifiedErrorTrackingIssuesFn = listUnnotifiedErrorTrackingIssues,
    logger = console,
    markErrorTrackingIssueNotificationSentFn = markErrorTrackingIssueNotificationSent,
    nowFn = () => new Date(),
    pool = null,
    resolveErrorTrackingContextFn = null,
    syncErrorTrackingIssueSnapshotFn = syncErrorTrackingIssueSnapshot,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    updateErrorTrackingRuntimeStateFn = updateErrorTrackingRuntimeState,
  } = options;

  const schedulerState = {
    inFlight: false,
    lastSkipLogMinuteKeyByReason: new Map(),
  };

  async function tick() {
    if (schedulerState.inFlight) {
      return;
    }

    schedulerState.inFlight = true;
    try {
      await runErrorTrackingSchedulerTick({
        communicationClient,
        errorTrackingClient,
        errorTrackingProvider,
        errorTrackingTimeoutMs,
        getErrorTrackingConfigFn,
        listUnnotifiedErrorTrackingIssuesFn,
        logger,
        markErrorTrackingIssueNotificationSentFn,
        nowFn,
        pool,
        resolveErrorTrackingContextFn,
        schedulerState,
        syncErrorTrackingIssueSnapshotFn,
        updateErrorTrackingRuntimeStateFn,
      });
    } finally {
      schedulerState.inFlight = false;
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

async function runErrorTrackingSchedulerTick({
  communicationClient,
  errorTrackingClient,
  errorTrackingProvider = "sentry",
  errorTrackingTimeoutMs = 15_000,
  getErrorTrackingConfigFn = getErrorTrackingConfig,
  listUnnotifiedErrorTrackingIssuesFn = listUnnotifiedErrorTrackingIssues,
  logger = console,
  markErrorTrackingIssueNotificationSentFn = markErrorTrackingIssueNotificationSent,
  nowFn = () => new Date(),
  pool,
  resolveErrorTrackingContextFn = null,
  schedulerState = { lastSkipLogMinuteKeyByReason: new Map() },
  syncErrorTrackingIssueSnapshotFn = syncErrorTrackingIssueSnapshot,
  updateErrorTrackingRuntimeStateFn = updateErrorTrackingRuntimeState,
}) {
  const now = nowFn();
  const resolvedContext = await resolveCurrentErrorTrackingContext({
    errorTrackingClient,
    errorTrackingProvider,
    resolveErrorTrackingContextFn,
  });
  const currentErrorTrackingClient = resolvedContext.errorTrackingClient;
  const currentErrorTrackingProvider = resolvedContext.errorTrackingProvider;

  if (!pool) {
    logSchedulerSkip({ logger, now, reason: "missing_pool", schedulerState });
    return null;
  }
  if (!currentErrorTrackingClient || typeof currentErrorTrackingClient.listUnresolvedIssues !== "function") {
    logSchedulerSkip({ logger, now, reason: "missing_client", schedulerState });
    return null;
  }
  if (!communicationClient || typeof communicationClient.postChannelMessage !== "function") {
    logSchedulerSkip({ logger, now, reason: "missing_communication_client", schedulerState });
    return null;
  }

  try {
    const config = await getErrorTrackingConfigFn(pool);
    if (!config.enabled) {
      logSchedulerSkip({ logger, now, reason: "disabled", schedulerState });
      return null;
    }
    if (!config.projectSlug) {
      logSchedulerSkip({ logger, now, reason: "missing_project", schedulerState });
      return null;
    }
    if (!config.targetChannelId) {
      logSchedulerSkip({ logger, now, reason: "missing_target_channel", schedulerState });
      return null;
    }

    const observedAt = now.toISOString();
    const unresolvedIssues = await currentErrorTrackingClient.listUnresolvedIssues({
      environment: config.environment,
      projectSlug: config.projectSlug,
      timeoutMs: errorTrackingTimeoutMs,
    });
    const suppressNotifications = !config.baselineCompletedAt;

    await withTransaction(pool, async (queryable) => {
      await syncErrorTrackingIssueSnapshotFn(queryable, {
        environment: config.environment,
        issues: unresolvedIssues.map((issue) => ({
          ...issue,
          firstSeenAt: issue.firstSeenAt,
          openedAt: issue.firstSeenAt,
          lastSeenAt: issue.lastSeenAt,
        })),
        observedAt,
        projectSlug: config.projectSlug,
        provider: currentErrorTrackingProvider,
        suppressNotifications,
      });

      await updateErrorTrackingRuntimeStateFn(queryable, {
        baselineCompletedAt: config.baselineCompletedAt || observedAt,
        lastSyncAt: observedAt,
        updatedBy: null,
        clearLastSyncError: true,
      });
    });

    if (suppressNotifications) {
      return {
        baselineApplied: true,
        postedCount: 0,
      };
    }

    const pendingIssues = await listUnnotifiedErrorTrackingIssuesFn(pool, {
      environment: config.environment,
      projectSlug: config.projectSlug,
      provider: currentErrorTrackingProvider,
    });
    let postedCount = 0;

    for (const issue of pendingIssues) {
      await communicationClient.postChannelMessage({
        channelId: config.targetChannelId,
        mrkdwn: true,
        text: buildErrorTrackingNotificationText(issue),
      });
      await markErrorTrackingIssueNotificationSentFn(pool, issue.id, observedAt);
      postedCount += 1;
    }

    return {
      baselineApplied: false,
      postedCount,
    };
  } catch (error) {
    logger.error("Error tracking scheduler tick failed.");
    logger.error(error.message);

    try {
      await updateErrorTrackingRuntimeStateFn(pool, {
        lastSyncError: String(error.message || "unknown error"),
      });
    } catch (_updateError) {
      logger.error("Failed to persist error tracking sync error state.");
    }

    return null;
  }
}

function buildErrorTrackingNotificationText(issue) {
  const alertType = issue.regressionCount > 0 ? "Error regression" : "Error alert";
  const identifier = issue.shortId || issue.externalIssueId || "unknown issue";
  const title = String(issue.title || "(untitled)").trim();
  const projectPart = issue.projectSlug ? ` project \`${issue.projectSlug}\`` : "";
  const environmentPart = issue.environment ? ` environment \`${issue.environment}\`` : "";
  const levelPart = issue.level ? ` level \`${issue.level}\`` : "";
  const firstSeenPart = issue.openedAt ? ` First seen: ${issue.openedAt}.` : "";
  const lastSeenPart = issue.lastSeenAt ? ` Last seen: ${issue.lastSeenAt}.` : "";
  const culpritPart = issue.culprit ? ` Culprit: ${issue.culprit}.` : "";
  const linkPart = issue.permalink ? ` ${issue.permalink}` : "";

  return `${alertType}: [${identifier}]${projectPart}${environmentPart}${levelPart} ${title}.${firstSeenPart}${lastSeenPart}${culpritPart}${linkPart}`.trim();
}

function logSchedulerSkip({ logger, now, reason, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastSkipLogMinuteKeyByReason.get(reason) === minuteKey) {
    return;
  }

  schedulerState.lastSkipLogMinuteKeyByReason.set(reason, minuteKey);
  if (reason === "missing_pool") {
    logger.info("Error tracking scheduler skipped: missing database pool.");
    return;
  }
  if (reason === "missing_client") {
    logger.info("Error tracking scheduler skipped: missing error tracking client.");
    return;
  }
  if (reason === "missing_communication_client") {
    logger.info("Error tracking scheduler skipped: missing communication client.");
    return;
  }
  if (reason === "disabled") {
    logger.info("Error tracking scheduler skipped: monitoring disabled.");
    return;
  }
  if (reason === "missing_project") {
    logger.info("Error tracking scheduler skipped: no project configured.");
    return;
  }

  logger.info("Error tracking scheduler skipped: no target channel configured.");
}

async function resolveCurrentErrorTrackingContext({
  errorTrackingClient,
  errorTrackingProvider,
  resolveErrorTrackingContextFn,
}) {
  if (typeof resolveErrorTrackingContextFn === "function") {
    const resolvedValue = await resolveErrorTrackingContextFn();
    if (resolvedValue && typeof resolvedValue === "object") {
      return {
        errorTrackingClient: resolvedValue.errorTrackingClient || null,
        errorTrackingProvider: resolvedValue.errorTrackingProvider || errorTrackingProvider,
      };
    }
  }

  return {
    errorTrackingClient,
    errorTrackingProvider,
  };
}

async function withTransaction(pool, callback) {
  if (typeof pool.connect !== "function") {
    await pool.query("BEGIN");
    try {
      const result = await callback(pool);
      await pool.query("COMMIT");
      return result;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  buildErrorTrackingNotificationText,
  runErrorTrackingSchedulerTick,
  startErrorTrackingScheduler,
};
