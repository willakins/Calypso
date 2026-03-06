const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createGmailWebhookHandler,
} = require("../../src/platform/email/providers/gmail/webhook");

test("gmail webhook returns 401 on invalid jwt", async () => {
  const handler = createGmailWebhookHandler({
    config: {
      emailGmailAddress: "support@example.com",
      emailWebhookAudience: "https://example.com/email/webhook",
    },
    pool: {},
    upsertPendingSupportEmailHistoryIdFn: async () => {
      throw new Error("should not be called");
    },
    verifyPushJwtFn: async () => ({ valid: false }),
  });

  const response = createResponseRecorder();
  await handler({ body: {}, headers: {} }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error, "invalid bearer token");
});

test("gmail webhook returns 400 for malformed pubsub payload", async () => {
  const handler = createGmailWebhookHandler({
    config: {
      emailGmailAddress: "support@example.com",
      emailWebhookAudience: "https://example.com/email/webhook",
    },
    pool: {},
    upsertPendingSupportEmailHistoryIdFn: async () => {
      throw new Error("should not be called");
    },
    verifyPushJwtFn: async () => ({ valid: true }),
  });

  const response = createResponseRecorder();
  await handler(
    {
      body: {
        message: {
          data: Buffer.from("{not-json", "utf8").toString("base64"),
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.error, "invalid pubsub payload");
});

test("gmail webhook ignores notifications for the wrong mailbox", async () => {
  let upsertCalled = false;
  const handler = createGmailWebhookHandler({
    config: {
      emailGmailAddress: "support@example.com",
      emailWebhookAudience: "https://example.com/email/webhook",
    },
    pool: {},
    upsertPendingSupportEmailHistoryIdFn: async () => {
      upsertCalled = true;
      return "123";
    },
    verifyPushJwtFn: async () => ({ valid: true }),
  });

  const response = createResponseRecorder();
  await handler(
    {
      body: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              emailAddress: "other@example.com",
              historyId: "123",
            }),
            "utf8",
          ).toString("base64"),
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ignored, true);
  assert.equal(upsertCalled, false);
});

test("gmail webhook stores pending history id for valid notifications", async () => {
  const calls = [];
  const handler = createGmailWebhookHandler({
    config: {
      emailGmailAddress: "support@example.com",
      emailWebhookAudience: "https://example.com/email/webhook",
    },
    pool: {},
    upsertPendingSupportEmailHistoryIdFn: async (_pool, historyId) => {
      calls.push(historyId);
      return historyId;
    },
    verifyPushJwtFn: async () => ({ valid: true }),
  });

  const response = createResponseRecorder();
  await handler(
    {
      body: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              emailAddress: "support@example.com",
              historyId: "456",
            }),
            "utf8",
          ).toString("base64"),
        },
      },
      headers: {
        authorization: "Bearer token",
      },
    },
    response,
  );

  assert.deepEqual(calls, ["456"]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.pendingHistoryId, "456");
});

function createResponseRecorder() {
  return {
    payload: null,
    statusCode: 200,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}
