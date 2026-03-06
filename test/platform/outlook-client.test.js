const assert = require("node:assert/strict");
const test = require("node:test");

const { createOutlookClient } = require("../../src/platform/email/providers/outlook/client");

test("createOutlookClient returns null when required config is missing", () => {
  assert.equal(createOutlookClient({ config: {} }), null);
  assert.equal(
    createOutlookClient({
      config: {
        emailOutlookAddress: "support@example.com",
        emailOutlookTenantId: "",
        emailOutlookClientId: "client-id",
        emailOutlookClientSecret: "client-secret",
      },
    }),
    null,
  );
});

test("createOutlookClient authenticates once and uses Graph to list messages and fetch metadata", async () => {
  const requests = [];
  const client = createOutlookClient({
    config: {
      emailOutlookAddress: "support@example.com",
      emailOutlookTenantId: "tenant-id",
      emailOutlookClientId: "client-id",
      emailOutlookClientSecret: "client-secret",
    },
    fetchFn: async (requestUrl, options = {}) => {
      const url = String(requestUrl);
      requests.push({ options, url });

      if (url.includes("/oauth2/v2.0/token")) {
        return buildResponse({
          body: {
            access_token: "graph-token",
            expires_in: 3600,
          },
        });
      }

      if (url.includes("/mailFolders/inbox/messages")) {
        return buildResponse({
          body: {
            value: [
              { id: "m1" },
              { id: "m2" },
            ],
          },
        });
      }

      if (url.includes("/messages/m1")) {
        return buildResponse({
          body: {
            conversationId: "conversation-1",
            from: {
              emailAddress: {
                address: "alice@example.com",
              },
            },
            id: "m1",
            receivedDateTime: "2026-03-06T12:00:00Z",
            subject: "Billing question",
          },
        });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    },
  });

  const messageRefs = await client.listRecentInboxMessages({
    afterTimestamp: "2026-03-06T00:00:00Z",
  });
  const metadata = await client.getMessageMetadata("m1");

  assert.deepEqual(messageRefs, [{ id: "m1" }, { id: "m2" }]);
  assert.equal(metadata.conversationId, "conversation-1");
  assert.equal(metadata.subject, "Billing question");
  assert.equal(requests.filter((request) => request.url.includes("/oauth2/v2.0/token")).length, 1);

  const inboxRequest = requests.find((request) => request.url.includes("/mailFolders/inbox/messages"));
  const inboxUrl = new URL(inboxRequest.url);
  assert.equal(inboxUrl.searchParams.get("$top"), "100");
  assert.equal(inboxUrl.searchParams.get("$orderby"), "receivedDateTime asc");
  assert.equal(
    inboxUrl.searchParams.get("$filter"),
    "receivedDateTime ge 2026-03-06T00:00:00.000Z",
  );

  const graphRequests = requests.filter((request) => request.url.includes("graph.microsoft.com"));
  assert.equal(graphRequests.length, 2);
  for (const request of graphRequests) {
    assert.equal(request.options.headers.Authorization, "Bearer graph-token");
  }
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
