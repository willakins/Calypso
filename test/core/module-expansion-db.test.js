const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cacheSupportEmailThreadMessageText,
  clearSupportEmailOnCall,
  getEnvironmentStatusConfig,
  getSupportEmailConfig,
  getSupportEmailThreadById,
  insertSupportEmailThread,
  markEnvironmentStatusNotificationSent,
  markSupportEmailThreadResponded,
  recordEnvironmentStatusObservation,
  setEnvironmentStatusChannel,
  setEnvironmentStatusEnabled,
  setEnvironmentStatusUrl,
  setSupportEmailChannel,
  setSupportEmailMonitorEnabled,
  setSupportEmailOnCall,
  updateSupportEmailRuntimeState,
  upsertPendingSupportEmailHistoryId,
} = require("../../src/db");

test("getEnvironmentStatusConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const config = await getEnvironmentStatusConfig(pool);

  assert.equal(config.enabled, false);
  assert.equal(config.targetUrl, null);
  assert.equal(config.lastObservedState, "unknown");
});

test("setEnvironmentStatusEnabled upserts enabled flag", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ enabled: true, last_observed_state: "unknown" }] };
    },
  };

  await setEnvironmentStatusEnabled(pool, true, "UADMIN");

  assert.match(captured.sql, /INSERT INTO environment_status_config/);
  assert.equal(captured.params[0], true);
  assert.equal(captured.params[10], "UADMIN");
});

test("setEnvironmentStatusUrl rejects invalid urls", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setEnvironmentStatusUrl(pool, "ftp://example.com", "UADMIN");
  }, /Unsupported environment status url/);
});

test("setEnvironmentStatusChannel requires a user id", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setEnvironmentStatusChannel(pool, "C123", "");
  }, /user id is required/);
});

test("recordEnvironmentStatusObservation updates observed state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ last_observed_state: "unhealthy" }] };
    },
  };

  await recordEnvironmentStatusObservation(pool, {
    lastObservedState: "unhealthy",
    lastCheckedAt: "2026-03-06T12:00:00.000Z",
    lastErrorMessage: "timeout",
  });

  assert.match(captured.sql, /UPDATE environment_status_config/);
  assert.equal(captured.params[0], "unhealthy");
  assert.equal(captured.params[4], "timeout");
});

test("markEnvironmentStatusNotificationSent rejects unsupported state", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await markEnvironmentStatusNotificationSent(pool, "unknown", null);
  }, /Unsupported environment status notified state/);
});

test("getSupportEmailConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const config = await getSupportEmailConfig(pool);

  assert.equal(config.enabled, false);
  assert.equal(config.targetChannelId, null);
  assert.equal(config.lastProcessedHistoryId, null);
});

test("setSupportEmailMonitorEnabled upserts enabled flag", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ enabled: true }] };
    },
  };

  await setSupportEmailMonitorEnabled(pool, true, "UADMIN");

  assert.match(captured.sql, /INSERT INTO support_email_config/);
  assert.equal(captured.params[0], true);
  assert.equal(captured.params[9], "UADMIN");
});

test("setSupportEmailChannel upserts target channel", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ target_channel_id: "CEMAIL" }] };
    },
  };

  await setSupportEmailChannel(pool, "CEMAIL", "UADMIN");

  assert.match(captured.sql, /INSERT INTO support_email_config/);
  assert.equal(captured.params[1], "CEMAIL");
});

test("setSupportEmailOnCall upserts user and expiration", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ on_call_user_id: "UONCALL" }] };
    },
  };

  await setSupportEmailOnCall(pool, "UONCALL", "2026-03-07T00:00:00.000Z", "UADMIN");

  assert.match(captured.sql, /INSERT INTO support_email_config/);
  assert.equal(captured.params[2], "UONCALL");
  assert.equal(captured.params[3], "2026-03-07T00:00:00.000Z");
});

test("clearSupportEmailOnCall clears configured on call state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ on_call_user_id: null }] };
    },
  };

  await clearSupportEmailOnCall(pool, "UADMIN");

  assert.match(captured.sql, /on_call_user_id = CASE/);
  assert.equal(captured.params[10], true);
});

test("upsertPendingSupportEmailHistoryId stores the max pending history id", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ pending_history_id: "12345" }] };
    },
  };

  const pendingHistoryId = await upsertPendingSupportEmailHistoryId(pool, "12345");

  assert.equal(pendingHistoryId, "12345");
  assert.match(captured.sql, /GREATEST/);
  assert.deepEqual(captured.params, ["12345"]);
});

test("updateSupportEmailRuntimeState updates sync state without a user id", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ last_processed_history_id: "200" }] };
    },
  };

  await updateSupportEmailRuntimeState(pool, {
    lastProcessedHistoryId: "200",
    lastSyncAt: "2026-03-06T12:00:00.000Z",
  });

  assert.match(captured.sql, /INSERT INTO support_email_config/);
  assert.equal(captured.params[4], "200");
  assert.equal(captured.params[8], "2026-03-06T12:00:00.000Z");
});

test("insertSupportEmailThread inserts a pending support email row", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [{ id: 42, gmail_thread_id: "thread-1" }] };
    },
  };

  const row = await insertSupportEmailThread(pool, {
    gmailThreadId: "thread-1",
    gmailFirstMessageId: "msg-1",
    firstReceivedAt: "2026-03-06T12:00:00.000Z",
    firstMessageText: "Hello, I need help with billing.",
    firstSender: "alice@example.com",
    sourceProvider: "gmail",
    subject: "Billing question",
  });

  assert.match(captured.sql, /INSERT INTO support_email_threads/);
  assert.equal(captured.params[0], "thread-1");
  assert.equal(captured.params[2], "gmail");
  assert.equal(captured.params[3], "Hello, I need help with billing.");
  assert.deepEqual(row, { id: 42, gmail_thread_id: "thread-1" });
});

test("getSupportEmailThreadById returns full draft context", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ id: 42, source_provider: "gmail", first_message_text: "Need help" }],
      };
    },
  };

  const row = await getSupportEmailThreadById(pool, 42);

  assert.match(captured.sql, /FROM support_email_threads/);
  assert.deepEqual(captured.params, [42]);
  assert.deepEqual(row, { id: 42, source_provider: "gmail", first_message_text: "Need help" });
});

test("cacheSupportEmailThreadMessageText updates cached body and provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ id: 42, source_provider: "outlook", first_message_text: "Resolved body" }],
      };
    },
  };

  const row = await cacheSupportEmailThreadMessageText(pool, 42, "Resolved body", "outlook");

  assert.match(captured.sql, /UPDATE support_email_threads/);
  assert.deepEqual(captured.params, [42, "Resolved body", "outlook"]);
  assert.deepEqual(row, { id: 42, source_provider: "outlook", first_message_text: "Resolved body" });
});

test("markSupportEmailThreadResponded marks a pending thread responded", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return {
          rows: [{ id: 5, status: "pending", subject: "Billing question", first_sender: "alice@example.com" }],
        };
      }

      return {
        rows: [{ id: 5, status: "responded", responded_by: "U123" }],
      };
    },
  };

  const result = await markSupportEmailThreadResponded(pool, 5, "U123");

  assert.equal(result.found, true);
  assert.equal(result.alreadyResponded, false);
  assert.equal(result.emailThread.status, "responded");
});

test("markSupportEmailThreadResponded returns alreadyResponded when thread is already handled", async () => {
  const pool = {
    async query() {
      return {
        rows: [{ id: 5, status: "responded", subject: "Billing question", first_sender: "alice@example.com" }],
      };
    },
  };

  const result = await markSupportEmailThreadResponded(pool, 5, "U123");

  assert.equal(result.found, true);
  assert.equal(result.alreadyResponded, true);
});
