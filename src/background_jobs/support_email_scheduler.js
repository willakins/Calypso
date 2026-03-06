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
    emailClient = null,
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
    resolveEmailClientFn = null,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    updateSupportEmailRuntimeStateFn = updateSupportEmailRuntimeState,
  } = options;
  const configuredEmailClient = emailClient || gmailClient || null;

  if (!pool || (!configuredEmailClient && typeof resolveEmailClientFn !== "function")) {
    logger.warn("Support email scheduler disabled: missing pool or email client.");
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
      emailClient: configuredEmailClient,
      emailSyncFallbackIntervalMs,
      emailWatchRenewIntervalMs,
      getSupportEmailConfigFn,
      insertSupportEmailThreadFn,
      listUnnotifiedSupportEmailThreadsFn,
      logger,
      markSupportEmailThreadNotificationSentFn,
      nowFn,
      pool,
      resolveEmailClientFn,
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
  emailClient,
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
  resolveEmailClientFn,
  schedulerState,
  updateSupportEmailRuntimeStateFn,
}) {
  try {
    const now = nowFn();
    const currentEmailClient = await resolveCurrentEmailClient({
      emailClient: emailClient || gmailClient || null,
      resolveEmailClientFn,
    });
    if (!currentEmailClient) {
      logSchedulerSkip({ logger, now, reason: "missing_email_client", schedulerState });
      return;
    }

    let config = await getSupportEmailConfigFn(pool);
    if (!config.enabled) {
      logSchedulerSkip({ logger, now, reason: "disabled", schedulerState });
      return;
    }

    if (
      typeof currentEmailClient.watchMailbox === "function" &&
      shouldRenewMailboxWatch({ config, emailWatchRenewIntervalMs, now, schedulerState })
    ) {
      schedulerState.lastWatchRenewAttemptAt = now.getTime();
      const watchState = await currentEmailClient.watchMailbox();
      config = await updateSupportEmailRuntimeStateFn(pool, {
        lastProcessedHistoryId: config.lastProcessedHistoryId || watchState.historyId,
        lastSyncAt: now.toISOString(),
        watchExpirationAt: watchState.expiration,
      });
    }

    if (!config.backfillCompletedAt) {
      config = await runSupportEmailBackfill({
        emailClient: currentEmailClient,
        insertSupportEmailThreadFn,
        now,
        pool,
        supportMailboxAddress: resolveMailboxAddress(currentEmailClient),
        updateSupportEmailRuntimeStateFn,
      });
    }

    const fallbackSyncDue = isFallbackSyncDue({
      config,
      emailSyncFallbackIntervalMs,
      now,
    });
    const supportsIncrementalSync = typeof currentEmailClient.listHistory === "function";
    const hasPendingHistory = supportsIncrementalSync
      ? compareHistoryIds(config.pendingHistoryId, config.lastProcessedHistoryId) > 0
      : false;
    if (supportsIncrementalSync && config.lastProcessedHistoryId && (hasPendingHistory || fallbackSyncDue)) {
      config = await syncSupportEmailHistory({
        config,
        emailClient: currentEmailClient,
        insertSupportEmailThreadFn,
        logger,
        now,
        pool,
        supportMailboxAddress: resolveMailboxAddress(currentEmailClient),
        updateSupportEmailRuntimeStateFn,
      });
    } else if (!supportsIncrementalSync && fallbackSyncDue) {
      config = await syncSupportEmailRecentMessages({
        config,
        emailClient: currentEmailClient,
        insertSupportEmailThreadFn,
        now,
        pool,
        supportMailboxAddress: resolveMailboxAddress(currentEmailClient),
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
  emailClient,
  insertSupportEmailThreadFn,
  now,
  pool,
  supportMailboxAddress,
  updateSupportEmailRuntimeStateFn,
}) {
  const backfillStartAt = new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const recentMessages = await emailClient.listRecentInboxMessages({
    afterTimestamp: backfillStartAt.toISOString(),
  });
  const pendingThreads = await buildSupportEmailThreadsFromMessageRefs({
    emailClient,
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
  emailClient,
  insertSupportEmailThreadFn,
  logger,
  now,
  pool,
  supportMailboxAddress,
  updateSupportEmailRuntimeStateFn,
}) {
  try {
    const historyResponse = await emailClient.listHistory({
      startHistoryId: config.lastProcessedHistoryId,
    });
    const messageRefs = extractMessageRefsFromHistory(historyResponse.history);
    const pendingThreads = await buildSupportEmailThreadsFromMessageRefs({
      emailClient,
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
    const watchState = await emailClient.watchMailbox();
    await updateSupportEmailRuntimeStateFn(pool, {
      backfillCompletedAt: null,
      lastProcessedHistoryId: watchState.historyId,
      lastSyncAt: now.toISOString(),
      watchExpirationAt: watchState.expiration,
      clearBackfillCompletedAt: true,
    });

    return runSupportEmailBackfill({
      emailClient,
      insertSupportEmailThreadFn,
      now,
      pool,
      supportMailboxAddress,
      updateSupportEmailRuntimeStateFn,
    });
  }
}

async function syncSupportEmailRecentMessages({
  config,
  emailClient,
  insertSupportEmailThreadFn,
  now,
  pool,
  supportMailboxAddress,
  updateSupportEmailRuntimeStateFn,
}) {
  const recentMessages = await emailClient.listRecentInboxMessages({
    afterTimestamp: config.lastSyncAt || config.backfillCompletedAt || null,
  });
  const pendingThreads = await buildSupportEmailThreadsFromMessageRefs({
    emailClient,
    messageRefs: recentMessages,
    supportMailboxAddress,
  });

  await withTransaction(pool, async (queryable) => {
    for (const thread of pendingThreads) {
      await insertSupportEmailThreadFn(queryable, thread);
    }

    await updateSupportEmailRuntimeStateFn(queryable, {
      lastSyncAt: now.toISOString(),
    });
  });

  return updateSupportEmailRuntimeStateFn(pool, {
    lastSyncAt: now.toISOString(),
  });
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
  emailClient,
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
    const message = await emailClient.getMessageMetadata(messageId);
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
  const gmailThreadId = String(message?.threadId || message?.conversationId || "").trim();
  const gmailFirstMessageId = String(message?.id || "").trim();
  const internalDate = normalizeMessageReceivedAt(message);
  const subject = readMessageSubject(message);
  const firstSender = readMessageSender(message);
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

function normalizeMessageReceivedAt(message) {
  const internalDate = normalizeInternalDate(message?.internalDate);
  if (internalDate) {
    return internalDate;
  }

  const receivedDateTime = String(message?.receivedDateTime || "").trim();
  if (!receivedDateTime) {
    return null;
  }

  const parsedDate = new Date(receivedDateTime);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
}

function readMessageSubject(message) {
  const directSubject = String(message?.subject || "").trim();
  if (directSubject) {
    return directSubject;
  }

  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  return readHeaderValue(headers, "Subject");
}

function readMessageSender(message) {
  const outlookSender = String(message?.from?.emailAddress?.address || "").trim();
  if (outlookSender) {
    return outlookSender.toLowerCase();
  }

  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  const fromHeader = readHeaderValue(headers, "From");
  return extractEmailAddress(fromHeader) || fromHeader || null;
}

function resolveMailboxAddress(emailClient) {
  return String(emailClient?.mailboxAddress || emailClient?.gmailAddress || "")
    .trim()
    .toLowerCase();
}

async function resolveCurrentEmailClient({ emailClient, resolveEmailClientFn }) {
  if (typeof resolveEmailClientFn === "function") {
    const resolvedValue = await resolveEmailClientFn();
    if (resolvedValue && typeof resolvedValue === "object" && "emailClient" in resolvedValue) {
      return resolvedValue.emailClient || null;
    }

    return resolvedValue || null;
  }

  return emailClient || null;
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
  if (reason === "missing_email_client") {
    logger.info("Support email scheduler skipped: missing email client.");
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
