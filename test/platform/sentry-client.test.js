const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSentryClient,
  mapSentryIssue,
  parseLinkHeader,
} = require("../../src/platform/error_tracking/providers/sentry/client");

test("createSentryClient returns null when required config is missing", () => {
  assert.equal(createSentryClient({ authToken: "", organizationSlug: "acme" }), null);
  assert.equal(createSentryClient({ authToken: "token", organizationSlug: "" }), null);
});

test("parseLinkHeader reads sentry pagination metadata", () => {
  const links = parseLinkHeader(
    '<https://sentry.io/api/0/issues/?cursor=abc>; rel="next"; results="true"; cursor="abc"',
  );

  assert.equal(links.next.url, "https://sentry.io/api/0/issues/?cursor=abc");
  assert.equal(links.next.results, "true");
  assert.equal(links.next.cursor, "abc");
});

test("mapSentryIssue normalizes an issue payload", () => {
  const issue = mapSentryIssue(
    {
      id: "17",
      shortId: "API-17",
      title: "Unhandled exception",
      culprit: "POST /api/orders",
      level: "error",
      permalink: "https://sentry.io/organizations/acme/issues/17/",
      firstSeen: "2026-03-06T12:00:00Z",
      lastSeen: "2026-03-06T12:05:00Z",
      count: "3",
      project: { slug: "api" },
    },
    {
      defaultEnvironment: "production",
      defaultProjectSlug: "fallback",
    },
  );

  assert.deepEqual(issue, {
    culprit: "POST /api/orders",
    environment: "production",
    eventCount: 3,
    externalIssueId: "17",
    firstSeenAt: "2026-03-06T12:00:00.000Z",
    lastSeenAt: "2026-03-06T12:05:00.000Z",
    level: "error",
    permalink: "https://sentry.io/organizations/acme/issues/17/",
    projectSlug: "api",
    shortId: "API-17",
    title: "Unhandled exception",
  });
});

test("createSentryClient resolves project ids and paginates unresolved issues", async () => {
  const requests = [];
  const client = createSentryClient({
    authToken: "sentry-token",
    baseUrl: "https://sentry.example.com",
    fetchFn: async (requestUrl) => {
      const url = String(requestUrl);
      requests.push(url);

      if (url.includes("/projects/")) {
        return buildResponse({
          body: [{ id: "42", slug: "api" }],
          headers: {
            link: "",
          },
        });
      }

      if (url.includes("cursor=page-2")) {
        return buildResponse({
          body: [
            {
              id: "2",
              shortId: "API-2",
              title: "Second issue",
              firstSeen: "2026-03-06T10:00:00Z",
              lastSeen: "2026-03-06T10:02:00Z",
              count: "7",
            },
          ],
          headers: {
            link: "",
          },
        });
      }

      return buildResponse({
        body: [
          {
            id: "1",
            shortId: "API-1",
            title: "First issue",
            firstSeen: "2026-03-06T09:00:00Z",
            lastSeen: "2026-03-06T09:01:00Z",
            count: "2",
          },
        ],
        headers: {
          link: '<https://sentry.example.com/api/0/organizations/acme/issues/?cursor=page-2>; rel="next"; results="true"; cursor="page-2"',
        },
      });
    },
    organizationSlug: "acme",
  });

  const issues = await client.listUnresolvedIssues({
    environment: "production",
    projectSlug: "api",
    timeoutMs: 5000,
  });

  assert.equal(requests.length, 3);
  assert.match(requests[0], /\/api\/0\/organizations\/acme\/projects\//);
  assert.match(requests[1], /\/api\/0\/organizations\/acme\/issues\//);
  assert.match(requests[1], /project=42/);
  assert.match(requests[1], /environment=production/);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].projectSlug, "api");
  assert.equal(issues[0].environment, "production");
  assert.equal(issues[1].shortId, "API-2");
});

test("createSentryClient surfaces request failures", async () => {
  const client = createSentryClient({
    authToken: "sentry-token",
    fetchFn: async (requestUrl) => {
      if (String(requestUrl).includes("/projects/")) {
        return buildResponse({
          body: [{ id: "42", slug: "api" }],
          headers: {
            link: "",
          },
        });
      }

      return buildResponse({
        ok: false,
        status: 401,
        body: { detail: "Invalid token" },
      });
    },
    organizationSlug: "acme",
  });

  await assert.rejects(
    () => client.listUnresolvedIssues({ projectSlug: "api" }),
    /Sentry API request failed \(401\).*Invalid token/,
  );
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
