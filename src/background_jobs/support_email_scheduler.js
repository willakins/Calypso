const {
  getSupportEmailConfig,
  insertSupportEmailThread,
  listUnnotifiedSupportEmailThreads,
  markSupportEmailThreadNotificationSent,
  updateSupportEmailRuntimeState,
} = require("../db");

const DEFAULT_BACKFILL_DAYS = 7;
const DEFAULT_TICK_INTERVAL_MS = 60_000;
const WATCH_RENEW_LEAD_MS = 24 * 60 * 60 * 1000;

function startSupportEmailScheduler(options = {}) {
  const {
    communicationClient = null,
    emailSyncFallbackIntervalMs = 5 * 60 * 1000,
    emailWatchRenewIntervalMs = 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn = getSupportEmailConfig,
    gmailClient = null,
    insertSupportEmailThreadFn = insertSupportEmailThread,
    listUnnotifiedSupportEmailThreadsFn = listUnnotifiedSupportEmailThreads,
    logger = console,
    markSupportEmailThreadNotificationSentFn = markSupportEmailThreadNotificationSent,
    nowFn = () => new Date(),
    pool,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    updateSupportEmailRuntimeStateFn = updateSupportEmailRuntimeState,
  } = options;

  if (!pool || !gmailClient) {
    logger.warn("Support email scheduler disabled: missing pool or Gmail client.");
    return {
      stop() {},
    };
  }

  const schedulerState = {
    lastSkipLogMinuteKeyByReason: new Map(),
    lastWatchRenewAttemptAt: 0,
  };

  async function tick() {
    await runSupportEmailSchedulerTick({
      communicationClient,
      emailSyncFallbackIntervalMs,
      emailWatchRenewIntervalMs,
      getSupportEmailConfigFn,
      gmailClient,
      insertSupportEmailThreadFn,
      listUnnotifiedSupportEmailThreadsFn,
      logger,
      markSupportEmailThreadNotificationSentFn,
      nowFn,
      pool,
      schedulerState,
      updateSupportEmailRuntimeStateFn,
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

async function runSupportEmailSchedulerTick({
  communicationClient,
  emailSyncFallbackIntervalMs,
  emailWatchRenewIntervalMs,
  getSupportEmailConfigFn,
  gmailClient,
  insertSupportEmailThreadFn,
  listUnnotifiedSupportEmailThreadsFn,
  logger,
  markSupportEmailThreadNotificationSentFn,
  nowFn,
  pool,
  schedulerState,
  updateSupportEmailRuntimeStateFn,
}) {
  try {
    const now = nowFn();
    let config = await getSupportEmailConfigFn(pool);
    if (!config.enabled) {
      logSchedulerSkip({ logger, now, reason: "disabled", schedulerState });
      return;
    }

    if (shouldRenewMailboxWatch({ config, emailWatchRenewIntervalMs, now, schedulerState })) {
      schedulerState.lastWatchRenewAttemptAt = now.getTime();
      const watchState = await gmailClient.watchMailbox();
      config = await updateSupportEmailRuntimeStateFn(pool, {
        lastProcessedHistoryId: config.lastProcessedHistoryId || watchState.historyId,
        lastSyncAt: now.toISOString(),
        watchExpirationAt: watchState.expiration,
      });
    }

    if (!config.backfillCompletedAt) {
      config = await runSupportEmailBackfill({
        gmailClient,
        insertSupportEmailThreadFn,
        now,
        pool,
        supportMailboxAddress: gmailClient.gmailAddress,
        updateSupportEmailRuntimeStateFn,
      });
    }

    const hasPendingHistory =
      compareHistoryIds(config.pendingHistoryId, config.lastProcessedHistoryId) > 0;
    const fallbackSyncDue = isFallbackSyncDue({
      config,
      emailSyncFallbackIntervalMs,
      now,
    });
    if (config.lastProcessedHistoryId && (hasPendingHistory || fallbackSyncDue)) {
      config = await syncSupportEmailHistory({
        config,
        gmailClient,
        insertSupportEmailThreadFn,
        logger,
        now,
        pool,
        supportMailboxAddress: gmailClient.gmailAddress,
        updateSupportEmailRuntimeStateFn,
      });
    }

    await deliverSupportEmailNotifications({
      communicationClient,
      config,
      listUnnotifiedSupportEmailThreadsFn,
      logger,
      markSupportEmailThreadNotificationSentFn,
      now,
      pool,
      schedulerState,
    });
  } catch (error) {
    logger.error("Support email scheduler tick failed.");
    logger.error(error.message);
  }
}

async function runSupportEmailBackfill({
  gmailClient,
  insertSupportEmailThreadFn,
  now,
  pool,
  supportMailboxAddress,
  updateSupportEmailRuntimeStateFn,
}) {
  const backfillStartAt = new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const recentMessages = await gmailClient.listRecentInboxMessages({
    afterTimestamp: backfillStartAt.toISOString(),
  });
  const pendingThreads = await buildSupportEmailThreadsFromMessageRefs({
    gmailClient,
    messageRefs: recentMessages,
    supportMailboxAddress,
  });

  await withTransaction(pool, async (queryable) => {
    for (const thread of pendingThreads) {
      await insertSupportEmailThreadFn(queryable, thread);
    }

    await updateSupportEmailRuntimeStateFn(queryable, {
      backfillCompletedAt: now.toISOString(),
      lastSyncAt: now.toISOString(),
    });
  });

  return updateSupportEmailRuntimeStateFn(pool, {
    backfillCompletedAt: now.toISOString(),
    lastSyncAt: now.toISOString(),
  });
}

async function syncSupportEmailHistory({
  config,
  gmailClient,
  insertSupportEmailThreadFn,
  logger,
  now,
  pool,
  supportMailboxAddress,
  updateSupportEmailRuntimeStateFn,
}) {
  try {
    const historyResponse = await gmailClient.listHistory({
      startHistoryId: config.lastProcessedHistoryId,
    });
    const messageRefs = extractMessageRefsFromHistory(historyResponse.history);
    const pendingThreads = await buildSupportEmailThreadsFromMessageRefs({
      gmailClient,
      messageRefs,
      supportMailboxAddress,
    });
    const nextHistoryId = historyResponse.historyId || config.pendingHistoryId || config.lastProcessedHistoryId;

    await withTransaction(pool, async (queryable) => {
      for (const thread of pendingThreads) {
        await insertSupportEmailThreadFn(queryable, thread);
      }

      await updateSupportEmailRuntimeStateFn(queryable, {
        lastProcessedHistoryId: nextHistoryId,
        lastSyncAt: now.toISOString(),
      });
    });

    return updateSupportEmailRuntimeStateFn(pool, {
      lastProcessedHistoryId: nextHistoryId,
      lastSyncAt: now.toISOString(),
    });
  } catch (error) {
    if (!isExpiredHistoryIdError(error)) {
      throw error;
    }

    logger.error("Support email history id expired. Re-establishing Gmail watch and rerunning backfill.");
    const watchState = await gmailClient.watchMailbox();
    await updateSupportEmailRuntimeStateFn(pool, {
      backfillCompletedAt: null,
      lastProcessedHistoryId: watchState.historyId,
      lastSyncAt: now.toISOString(),
      watchExpirationAt: watchState.expiration,
      clearBackfillCompletedAt: true,
    });

    return runSupportEmailBackfill({
      gmailClient,
      insertSupportEmailThreadFn,
      now,
      pool,
      supportMailboxAddress,
      updateSupportEmailRuntimeStateFn,
    });
  }
}

async function deliverSupportEmailNotifications({
  communicationClient,
  config,
  listUnnotifiedSupportEmailThreadsFn,
  logger,
  markSupportEmailThreadNotificationSentFn,
  now,
  pool,
  schedulerState,
}) {
  if (!communicationClient || typeof communicationClient.postChannelMessage !== "function") {
    logSchedulerSkip({ logger, now, reason: "missing_communication_client", schedulerState });
    return;
  }
  if (!config.targetChannelId) {
    logSchedulerSkip({ logger, now, reason: "missing_target_channel", schedulerState });
    return;
  }

  const emailThreads = await listUnnotifiedSupportEmailThreadsFn(pool);
  for (const emailThread of emailThreads) {
    await communicationClient.postChannelMessage({
      channelId: config.targetChannelId,
      mrkdwn: true,
      text: buildSupportEmailNotificationText({
        emailThread,
        onCallUserId: resolveActiveOnCallUserId(config, now),
        provider: communicationClient.provider,
      }),
    });

    await markSupportEmailThreadNotificationSentFn(pool, emailThread.id, now.toISOString());
  }
}

async function buildSupportEmailThreadsFromMessageRefs({
  gmailClient,
  messageRefs,
  supportMailboxAddress,
}) {
  const normalizedMailboxAddress = String(supportMailboxAddress || "").trim().toLowerCase();
  const messageIdSet = new Set(
    messageRefs
      .map((messageRef) => String(messageRef?.id || "").trim())
      .filter(Boolean),
  );
  const threadCandidatesByThreadId = new Map();

  for (const messageId of messageIdSet) {
    const message = await gmailClient.getMessageMetadata(messageId);
    const candidateThread = mapMessageToSupportEmailThread(message, normalizedMailboxAddress);
    if (!candidateThread) {
      continue;
    }

    const existingThread = threadCandidatesByThreadId.get(candidateThread.gmailThreadId);
    if (!existingThread || candidateThread.firstReceivedAt < existingThread.firstReceivedAt) {
      threadCandidatesByThreadId.set(candidateThread.gmailThreadId, candidateThread);
    }
  }

  return [...threadCandidatesByThreadId.values()].sort((left, right) => {
    return left.firstReceivedAt.localeCompare(right.firstReceivedAt);
  });
}

function mapMessageToSupportEmailThread(message, supportMailboxAddress) {
  const gmailThreadId = String(message?.threadId || "").trim();
  const gmailFirstMessageId = String(message?.id || "").trim();
  const internalDate = normalizeInternalDate(message?.internalDate);
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  const subject = readHeaderValue(headers, "Subject");
  const fromHeader = readHeaderValue(headers, "From");
  const firstSender = extractEmailAddress(fromHeader) || fromHeader || null;
  const normalizedFirstSender = String(firstSender || "").trim().toLowerCase();

  if (!gmailThreadId || !gmailFirstMessageId || !internalDate) {
    return null;
  }
  if (!normalizedFirstSender || normalizedFirstSender === supportMailboxAddress) {
    return null;
  }

  return {
    gmailFirstMessageId,
    gmailThreadId,
    firstReceivedAt: internalDate,
    firstSender,
    subject,
  };
}

function extractMessageRefsFromHistory(historyEntries) {
  const messageRefs = [];
  for (const historyEntry of historyEntries || []) {
    const messagesAdded = Array.isArray(historyEntry?.messagesAdded) ? historyEntry.messagesAdded : [];
    for (const messageAdded of messagesAdded) {
      if (messageAdded?.message?.id) {
        messageRefs.push({
          id: messageAdded.message.id,
          threadId: messageAdded.message.threadId,
        });
      }
    }
  }

  return messageRefs;
}

function resolveActiveOnCallUserId(config, now) {
  if (!config.onCallUserId || !config.onCallExpiresAt) {
    return null;
  }

  const expiresAt = new Date(config.onCallExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now.getTime() ? config.onCallUserId : null;
}

function buildSupportEmailNotificationText({ emailThread, onCallUserId, provider }) {
  const sender = String(emailThread.first_sender || "").trim() || "unknown sender";
  const subject = String(emailThread.subject || "").trim() || "(no subject)";
  const onCallSuffix = onCallUserId
    ? ` On call: ${formatOnCallReference({ provider, userId: onCallUserId })}.`
    : "";
  return `New customer support email: ${sender} | ${subject}.${onCallSuffix}`;
}

function formatOnCallReference({ provider, userId }) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return "unknown";
  }

  return provider === "slack" ? `<@${normalizedUserId}>` : normalizedUserId;
}

function readHeaderValue(headers, headerName) {
  const normalizedHeaderName = String(headerName || "").toLowerCase().trim();
  const header = headers.find((candidate) => {
    return String(candidate?.name || "").toLowerCase().trim() === normalizedHeaderName;
  });
  const value = String(header?.value || "").trim();
  return value === "" ? null : value;
}

function extractEmailAddress(rawFromHeader) {
  const normalizedHeader = String(rawFromHeader || "").trim();
  if (!normalizedHeader) {
    return null;
  }

  const angleBracketMatch = normalizedHeader.match(/<([^>]+)>/);
  if (angleBracketMatch) {
    return String(angleBracketMatch[1] || "").trim().toLowerCase() || null;
  }

  const emailMatch = normalizedHeader.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].toLowerCase() : normalizedHeader;
}

function normalizeInternalDate(value) {
  const normalizedValue = String(value || "").trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const milliseconds = Number(normalizedValue);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }

  return new Date(milliseconds).toISOString();
}

function shouldRenewMailboxWatch({ config, emailWatchRenewIntervalMs, now, schedulerState }) {
  if (schedulerState.lastWatchRenewAttemptAt + emailWatchRenewIntervalMs > now.getTime()) {
    return false;
  }

  if (!config.watchExpirationAt) {
    return true;
  }

  return new Date(config.watchExpirationAt).getTime() - WATCH_RENEW_LEAD_MS <= now.getTime();
}

function isFallbackSyncDue({ config, emailSyncFallbackIntervalMs, now }) {
  if (!config.lastSyncAt) {
    return true;
  }

  return new Date(config.lastSyncAt).getTime() + emailSyncFallbackIntervalMs <= now.getTime();
}

function isExpiredHistoryIdError(error) {
  return Number(error?.status) === 404 && /history/i.test(String(error?.message || ""));
}

function compareHistoryIds(left, right) {
  const normalizedLeft = String(left || "").trim();
  const normalizedRight = String(right || "").trim();
  if (!normalizedLeft && !normalizedRight) {
    return 0;
  }
  if (!normalizedLeft) {
    return -1;
  }
  if (!normalizedRight) {
    return 1;
  }

  const leftValue = BigInt(normalizedLeft);
  const rightValue = BigInt(normalizedRight);
  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
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

function logSchedulerSkip({ logger, now, reason, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastSkipLogMinuteKeyByReason.get(reason) === minuteKey) {
    return;
  }

  schedulerState.lastSkipLogMinuteKeyByReason.set(reason, minuteKey);
  if (reason === "disabled") {
    logger.info("Support email scheduler skipped: monitoring disabled.");
    return;
  }
  if (reason === "missing_communication_client") {
    logger.info("Support email scheduler notifications skipped: no communication client configured.");
    return;
  }

  logger.info("Support email scheduler notifications skipped: no target channel configured.");
}

module.exports = {
  buildSupportEmailNotificationText,
  compareHistoryIds,
  extractEmailAddress,
  extractMessageRefsFromHistory,
  mapMessageToSupportEmailThread,
  runSupportEmailSchedulerTick,
  startSupportEmailScheduler,
};
