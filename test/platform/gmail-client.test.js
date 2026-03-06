const assert = require("node:assert/strict");
const test = require("node:test");

const { createGmailClient } = require("../../src/platform/email/providers/gmail/client");

test("createGmailClient returns null when required config is missing", () => {
  assert.equal(createGmailClient({ config: {} }), null);
  assert.equal(
    createGmailClient({
      config: {
        emailGmailAddress: "support@example.com",
        emailGmailClientId: "client-id",
        emailGmailClientSecret: "client-secret",
        emailGmailRefreshToken: "",
        emailGmailPubsubTopic: "projects/test/topics/support",
      },
    }),
    null,
  );
});

test("createGmailClient authenticates once and fetches normalized message detail", async () => {
  const requests = [];
  const client = createGmailClient({
    config: {
      emailGmailAddress: "support@example.com",
      emailGmailClientId: "client-id",
      emailGmailClientSecret: "client-secret",
      emailGmailRefreshToken: "refresh-token",
      emailGmailPubsubTopic: "projects/test/topics/support",
    },
    fetchFn: async (requestUrl, options = {}) => {
      const url = String(requestUrl);
      requests.push({ options, url });

      if (url === "https://oauth2.googleapis.com/token") {
        return buildResponse({
          body: {
            access_token: "gmail-token",
            expires_in: 3600,
          },
        });
      }

      if (url.includes("/messages/m1")) {
        return buildResponse({
          body: {
            id: "m1",
            internalDate: "1741262400000",
            payload: {
              headers: [
                { name: "From", value: "Alice <alice@example.com>" },
                { name: "Subject", value: "Billing question" },
              ],
              parts: [
                {
                  body: {
                    data: encodeBase64Url("Hello,\n\nI need help with billing."),
                  },
                  mimeType: "text/plain",
                },
              ],
            },
            threadId: "thread-1",
          },
        });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    },
  });

  const detail = await client.getMessageDetail("m1");

  assert.equal(detail.id, "m1");
  assert.equal(detail.threadId, "thread-1");
  assert.equal(detail.fromAddress, "alice@example.com");
  assert.equal(detail.subject, "Billing question");
  assert.equal(detail.plainTextBody, "Hello,\n\nI need help with billing.");
  assert.equal(requests.filter((request) => request.url === "https://oauth2.googleapis.com/token").length, 1);
});

test("createGmailClient falls back to html body when plain text is missing", async () => {
  const client = createGmailClient({
    config: {
      emailGmailAddress: "support@example.com",
      emailGmailClientId: "client-id",
      emailGmailClientSecret: "client-secret",
      emailGmailRefreshToken: "refresh-token",
      emailGmailPubsubTopic: "projects/test/topics/support",
    },
    fetchFn: async (requestUrl) => {
      const url = String(requestUrl);
      if (url === "https://oauth2.googleapis.com/token") {
        return buildResponse({
          body: {
            access_token: "gmail-token",
            expires_in: 3600,
          },
        });
      }

      return buildResponse({
        body: {
          id: "m2",
          internalDate: "1741262400000",
          payload: {
            headers: [
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "Subject", value: "HTML message" },
            ],
            parts: [
              {
                body: {
                  data: encodeBase64Url("<p>Hello <strong>there</strong>.</p>"),
                },
                mimeType: "text/html",
              },
            ],
          },
          threadId: "thread-2",
        },
      });
    },
  });

  const detail = await client.getMessageDetail("m2");

  assert.equal(detail.plainTextBody, "Hello there.");
});

function buildResponse({ body, headers = {}, ok = true, status = 200 }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
