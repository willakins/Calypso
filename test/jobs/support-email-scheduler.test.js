const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSupportEmailNotificationText,
  compareHistoryIds,
  extractEmailAddress,
  runSupportEmailSchedulerTick,
} = require("../../src/background_jobs/support_email_scheduler");

test("compareHistoryIds compares Gmail history ids numerically", () => {
  assert.equal(compareHistoryIds("100", "99"), 1);
  assert.equal(compareHistoryIds("100", "100"), 0);
  assert.equal(compareHistoryIds("99", "100"), -1);
});

test("extractEmailAddress prefers the mailbox address from From header", () => {
  assert.equal(extractEmailAddress("Customer Support <help@example.com>"), "help@example.com");
  assert.equal(extractEmailAddress("person@example.com"), "person@example.com");
});

test("buildSupportEmailNotificationText includes slack on call mention when active", () => {
  const text = buildSupportEmailNotificationText({
    emailThread: {
      first_sender: "alice@example.com",
      subject: "Billing question",
    },
    onCallUserId: "UONCALL",
    provider: "slack",
  });

  assert.match(text, /New customer support email: alice@example.com \| Billing question/);
  assert.match(text, /On call: <@UONCALL>/);
});

test("runSupportEmailSchedulerTick stays quiet and does not resolve email client when monitoring is disabled", async () => {
  let resolveCallCount = 0;
  const logger = capturingLogger();

  await runSupportEmailSchedulerTick({
    communicationClient: null,
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => createSupportEmailState().config,
    insertSupportEmailThreadFn: async () => null,
    listUnnotifiedSupportEmailThreadsFn: async () => [],
    logger,
    markSupportEmailThreadNotificationSentFn: async () => null,
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: createTransactionalPool(),
    resolveEmailClientFn: async () => {
      resolveCallCount += 1;
      return null;
    },
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: 0,
    },
    updateSupportEmailRuntimeStateFn: async () => ({}),
  });

  assert.equal(resolveCallCount, 0);
  assert.deepEqual(logger.messages, []);
});

test("runSupportEmailSchedulerTick performs initial backfill and posts a notification", async () => {
  const state = createSupportEmailState({
    config: {
      enabled: true,
      targetChannelId: "CEMAIL",
      onCallExpiresAt: "2026-03-07T12:00:00.000Z",
      onCallUserId: "UONCALL",
    },
  });
  const calls = {
    posts: [],
    recentMessageLists: 0,
    watchCalls: 0,
  };

  await runSupportEmailSchedulerTick({
    communicationClient: {
      provider: "slack",
      async postChannelMessage(message) {
        calls.posts.push(message);
      },
    },
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.config,
    gmailClient: {
      gmailAddress: "support@example.com",
      provider: "gmail",
      async getMessageDetail(messageId) {
        assert.equal(messageId, "m1");
        return buildMessageDetail({
          fromAddress: "alice@example.com",
          id: "m1",
          plainTextBody: "Hello, I need help with billing.",
          receivedAt: "2025-03-06T12:00:00.000Z",
          subject: "Billing question",
          threadId: "thread-1",
        });
      },
      async listRecentInboxMessages() {
        calls.recentMessageLists += 1;
        return [{ id: "m1" }];
      },
      async watchMailbox() {
        calls.watchCalls += 1;
        return {
          expiration: "2026-03-10T00:00:00.000Z",
          historyId: "100",
        };
      },
    },
    insertSupportEmailThreadFn: async (_pool, thread) => {
      if (!state.threads.some((candidate) => candidate.gmail_thread_id === thread.gmailThreadId)) {
        state.threads.push({
          id: state.nextId++,
          first_sender: thread.firstSender,
          first_message_text: thread.firstMessageText,
          first_received_at: thread.firstReceivedAt,
          gmail_thread_id: thread.gmailThreadId,
          notification_sent_at: null,
          source_provider: thread.sourceProvider,
          subject: thread.subject,
          status: "pending",
        });
      }
      return state.threads[state.threads.length - 1];
    },
    listUnnotifiedSupportEmailThreadsFn: async () =>
      state.threads.filter((thread) => thread.notification_sent_at === null),
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async (_pool, emailId, notificationSentAt) => {
      const thread = state.threads.find((candidate) => candidate.id === emailId);
      thread.notification_sent_at = notificationSentAt;
      return thread;
    },
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: 0,
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(calls.watchCalls, 1);
  assert.equal(calls.recentMessageLists, 1);
  assert.equal(state.threads.length, 1);
  assert.equal(state.config.backfillCompletedAt, "2026-03-06T12:00:00.000Z");
  assert.equal(state.config.lastProcessedHistoryId, "100");
  assert.equal(calls.posts.length, 1);
  assert.match(calls.posts[0].text, /New customer support email: alice@example.com \| Billing question/);
  assert.match(calls.posts[0].text, /On call: <@UONCALL>/);
  assert.equal(state.threads[0].source_provider, "gmail");
  assert.equal(state.threads[0].first_message_text, "Hello, I need help with billing.");
  assert.ok(state.threads[0].notification_sent_at);
});

test("runSupportEmailSchedulerTick syncs Gmail history and dedupes by thread while ignoring support mailbox messages", async () => {
  const state = createSupportEmailState({
    config: {
      backfillCompletedAt: "2026-03-05T12:00:00.000Z",
      enabled: true,
      lastProcessedHistoryId: "100",
      pendingHistoryId: "150",
      targetChannelId: null,
      watchExpirationAt: "2026-03-10T00:00:00.000Z",
    },
  });

  await runSupportEmailSchedulerTick({
    communicationClient: null,
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.config,
    gmailClient: {
      gmailAddress: "support@example.com",
      provider: "gmail",
      async getMessageDetail(messageId) {
        if (messageId === "m-support") {
          return buildMessageDetail({
            fromAddress: "support@example.com",
            id: "m-support",
            plainTextBody: "Internal follow-up.",
            receivedAt: "2025-03-06T12:00:00.000Z",
            subject: "Ignored",
            threadId: "thread-support",
          });
        }

        return buildMessageDetail({
          fromAddress: "alice@example.com",
          id: messageId,
          plainTextBody: messageId === "m1" ? "First customer message." : "Second customer message.",
          receivedAt:
            messageId === "m1"
              ? "2025-03-06T12:00:00.000Z"
              : "2025-03-06T12:01:00.000Z",
          subject: "Billing question",
          threadId: "thread-1",
        });
      },
      async listHistory() {
        return {
          history: [
            { messagesAdded: [{ message: { id: "m1", threadId: "thread-1" } }] },
            { messagesAdded: [{ message: { id: "m2", threadId: "thread-1" } }] },
            { messagesAdded: [{ message: { id: "m-support", threadId: "thread-support" } }] },
          ],
          historyId: "150",
        };
      },
      async listRecentInboxMessages() {
        return [];
      },
      async watchMailbox() {
        throw new Error("watchMailbox should not be called");
      },
    },
    insertSupportEmailThreadFn: async (_pool, thread) => {
      if (!state.threads.some((candidate) => candidate.gmail_thread_id === thread.gmailThreadId)) {
        state.threads.push({
          id: state.nextId++,
          first_sender: thread.firstSender,
          first_message_text: thread.firstMessageText,
          first_received_at: thread.firstReceivedAt,
          gmail_thread_id: thread.gmailThreadId,
          notification_sent_at: null,
          source_provider: thread.sourceProvider,
          subject: thread.subject,
          status: "pending",
        });
      }
      return state.threads[state.threads.length - 1];
    },
    listUnnotifiedSupportEmailThreadsFn: async () => [],
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async () => null,
    nowFn: () => new Date("2026-03-06T12:05:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: Date.parse("2026-03-06T11:00:00.000Z"),
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(state.threads.length, 1);
  assert.equal(state.threads[0].gmail_thread_id, "thread-1");
  assert.equal(state.threads[0].source_provider, "gmail");
  assert.equal(state.threads[0].first_message_text, "First customer message.");
  assert.equal(state.config.lastProcessedHistoryId, "150");
});

test("runSupportEmailSchedulerTick re-establishes watch and reruns backfill when history id expires", async () => {
  const state = createSupportEmailState({
    config: {
      backfillCompletedAt: "2026-03-05T12:00:00.000Z",
      enabled: true,
      lastProcessedHistoryId: "100",
      pendingHistoryId: "150",
      targetChannelId: null,
      watchExpirationAt: "2026-03-10T00:00:00.000Z",
    },
  });
  let watchCallCount = 0;

  await runSupportEmailSchedulerTick({
    communicationClient: null,
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.config,
    gmailClient: {
      gmailAddress: "support@example.com",
      provider: "gmail",
      async getMessageDetail() {
        return buildMessageDetail({
          fromAddress: "alice@example.com",
          id: "m-backfill",
          plainTextBody: "Reset flow body.",
          receivedAt: "2025-03-06T12:00:00.000Z",
          subject: "Reset flow",
          threadId: "thread-reset",
        });
      },
      async listHistory() {
        const error = new Error("historyId too old");
        error.status = 404;
        throw error;
      },
      async listRecentInboxMessages() {
        return [{ id: "m-backfill" }];
      },
      async watchMailbox() {
        watchCallCount += 1;
        return {
          expiration: "2026-03-12T00:00:00.000Z",
          historyId: "200",
        };
      },
    },
    insertSupportEmailThreadFn: async (_pool, thread) => {
      if (!state.threads.some((candidate) => candidate.gmail_thread_id === thread.gmailThreadId)) {
        state.threads.push({
          id: state.nextId++,
          first_sender: thread.firstSender,
          first_message_text: thread.firstMessageText,
          first_received_at: thread.firstReceivedAt,
          gmail_thread_id: thread.gmailThreadId,
          notification_sent_at: null,
          source_provider: thread.sourceProvider,
          subject: thread.subject,
          status: "pending",
        });
      }
      return state.threads[state.threads.length - 1];
    },
    listUnnotifiedSupportEmailThreadsFn: async () => [],
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async () => null,
    nowFn: () => new Date("2026-03-06T12:05:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: Date.parse("2026-03-06T11:00:00.000Z"),
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(watchCallCount, 1);
  assert.equal(state.config.lastProcessedHistoryId, "200");
  assert.equal(state.config.watchExpirationAt, "2026-03-12T00:00:00.000Z");
  assert.ok(state.config.backfillCompletedAt);
  assert.equal(state.threads.length, 1);
  assert.equal(state.threads[0].source_provider, "gmail");
  assert.equal(state.threads[0].first_message_text, "Reset flow body.");
});

test("runSupportEmailSchedulerTick polls recent messages for providers without history sync", async () => {
  const state = createSupportEmailState({
    config: {
      backfillCompletedAt: "2026-03-05T12:00:00.000Z",
      enabled: true,
      lastSyncAt: "2026-03-06T11:50:00.000Z",
      targetChannelId: null,
    },
  });
  let recentMessageCalls = 0;

  await runSupportEmailSchedulerTick({
    communicationClient: null,
    emailClient: {
      mailboxAddress: "support@example.com",
      provider: "outlook",
      async getMessageDetail(messageId) {
        assert.equal(messageId, "m-outlook-1");
        return buildMessageDetail({
          fromAddress: "alice@example.com",
          id: "m-outlook-1",
          plainTextBody: "I need help with my account.",
          receivedAt: "2026-03-06T11:55:00.000Z",
          subject: "Need help",
          threadId: "conversation-1",
        });
      },
      async listRecentInboxMessages({ afterTimestamp }) {
        recentMessageCalls += 1;
        assert.equal(afterTimestamp, "2026-03-06T11:50:00.000Z");
        return [{ id: "m-outlook-1" }];
      },
    },
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.config,
    insertSupportEmailThreadFn: async (_pool, thread) => {
      if (!state.threads.some((candidate) => candidate.gmail_thread_id === thread.gmailThreadId)) {
        state.threads.push({
          id: state.nextId++,
          first_sender: thread.firstSender,
          first_message_text: thread.firstMessageText,
          first_received_at: thread.firstReceivedAt,
          gmail_thread_id: thread.gmailThreadId,
          notification_sent_at: null,
          source_provider: thread.sourceProvider,
          subject: thread.subject,
          status: "pending",
        });
      }
      return state.threads[state.threads.length - 1];
    },
    listUnnotifiedSupportEmailThreadsFn: async () => [],
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async () => null,
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: 0,
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.config, updates);
      return { ...state.config };
    },
  });

  assert.equal(recentMessageCalls, 1);
  assert.equal(state.threads.length, 1);
  assert.equal(state.threads[0].gmail_thread_id, "conversation-1");
  assert.equal(state.threads[0].first_sender, "alice@example.com");
  assert.equal(state.threads[0].source_provider, "outlook");
  assert.equal(state.threads[0].first_message_text, "I need help with my account.");
  assert.equal(state.config.lastSyncAt, "2026-03-06T12:00:00.000Z");
});

function buildMessageDetail({ fromAddress, id, plainTextBody, receivedAt, subject, threadId }) {
  return {
    fromAddress,
    id,
    plainTextBody,
    receivedAt,
    subject,
    threadId,
  };
}

function createSupportEmailState({ config = {} } = {}) {
  return {
    config: {
      backfillCompletedAt: null,
      enabled: false,
      lastProcessedHistoryId: null,
      lastSyncAt: null,
      onCallExpiresAt: null,
      onCallUserId: null,
      pendingHistoryId: null,
      targetChannelId: null,
      watchExpirationAt: null,
      ...config,
    },
    nextId: 1,
    threads: [],
  };
}

function applySupportEmailConfigUpdates(config, updates) {
  if (updates.lastProcessedHistoryId !== undefined) {
    config.lastProcessedHistoryId = updates.lastProcessedHistoryId;
  }
  if (updates.pendingHistoryId !== undefined) {
    config.pendingHistoryId = updates.pendingHistoryId;
  }
  if (updates.watchExpirationAt !== undefined) {
    config.watchExpirationAt = updates.watchExpirationAt;
  }
  if (updates.backfillCompletedAt !== undefined) {
    config.backfillCompletedAt = updates.backfillCompletedAt;
  }
  if (updates.lastSyncAt !== undefined) {
    config.lastSyncAt = updates.lastSyncAt;
  }
  if (updates.clearBackfillCompletedAt) {
    config.backfillCompletedAt = null;
  }
}

function createTransactionalPool() {
  return {
    async query() {
      return { rows: [] };
    },
  };
}

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}

function capturingLogger() {
  const messages = [];
  return {
    messages,
    error(message) {
      messages.push(message);
    },
    info(message) {
      messages.push(message);
    },
    warn(message) {
      messages.push(message);
    },
  };
}
