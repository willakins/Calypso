const assert = require("node:assert/strict");
const test = require("node:test");

const { createRollbarClient } = require("../../src/platform/error_tracking/providers/rollbar/client");

test("createRollbarClient returns null when auth is missing", () => {
  assert.equal(createRollbarClient({ accessToken: "" }), null);
});

test("createRollbarClient paginates unresolved items and maps Rollbar issue fields", async () => {
  const requests = [];
  const client = createRollbarClient({
    accessToken: "rollbar-token",
    baseUrl: "https://api.rollbar.example.com",
    fetchFn: async (requestUrl, options = {}) => {
      const url = String(requestUrl);
      requests.push({ options, url });

      if (url.includes("page=2")) {
        return buildResponse({
          body: {
            result: {
              items: [
                {
                  counter: "API-18",
                  first_occurrence_timestamp: 1741258800,
                  id: "18",
                  item_url: "https://rollbar.com/acme/items/18/",
                  last_occurrence: {
                    environment: "production",
                    level: "warning",
                  },
                  last_occurrence_timestamp: 1741259400,
                  project: { slug: "api" },
                  title: "Second issue",
                  total_occurrences: 4,
                },
              ],
              total_pages: 2,
            },
          },
        });
      }

      return buildResponse({
        body: {
          result: {
            items: [
              {
                counter: "API-17",
                first_occurrence_timestamp: 1741255200,
                id: "17",
                item_url: "https://rollbar.com/acme/items/17/",
                last_occurrence: {
                  body: {
                    message: {
                      body: "Database unavailable",
                    },
                  },
                  environment: "production",
                  level: "error",
                },
                last_occurrence_timestamp: 1741255800,
                project: { slug: "api" },
                title: "First issue",
                total_occurrences: 3,
              },
            ],
            total_pages: 2,
          },
        },
      });
    },
  });

  const issues = await client.listUnresolvedIssues({
    environment: "production",
    projectSlug: "42",
    timeoutMs: 5000,
  });

  assert.equal(requests.length, 2);
  const firstRequestUrl = new URL(requests[0].url);
  assert.equal(firstRequestUrl.searchParams.get("project_id"), "42");
  assert.equal(firstRequestUrl.searchParams.get("environment"), "production");
  assert.equal(firstRequestUrl.searchParams.get("status"), "active");
  assert.equal(requests[0].options.headers["X-Rollbar-Access-Token"], "rollbar-token");

  assert.equal(issues.length, 2);
  assert.deepEqual(issues[0], {
    culprit: "Database unavailable",
    environment: "production",
    eventCount: 3,
    externalIssueId: "17",
    firstSeenAt: "2025-03-06T10:00:00.000Z",
    lastSeenAt: "2025-03-06T10:10:00.000Z",
    level: "error",
    permalink: "https://rollbar.com/acme/items/17/",
    projectSlug: "api",
    shortId: "API-17",
    title: "First issue",
  });
  assert.equal(issues[1].shortId, "API-18");
});

test("createRollbarClient surfaces API request failures", async () => {
  const client = createRollbarClient({
    accessToken: "rollbar-token",
    fetchFn: async () => {
      return buildResponse({
        ok: false,
        status: 401,
        body: { message: "Invalid token" },
      });
    },
  });

  await assert.rejects(
    () => client.listUnresolvedIssues({ projectSlug: "42" }),
    /Rollbar API request failed \(401\).*Invalid token/,
  );
});

function buildResponse({ body, ok = true, status = 200 }) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
