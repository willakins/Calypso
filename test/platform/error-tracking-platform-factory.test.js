const assert = require("node:assert/strict");
const test = require("node:test");

const { ERROR_TRACKING_PROVIDERS } = require("../../src/config");
const { createErrorTrackingPlatform } = require("../../src/platform/error_tracking/factory");

test("createErrorTrackingPlatform builds sentry provider", () => {
  const platform = createErrorTrackingPlatform({
    provider: ERROR_TRACKING_PROVIDERS.sentry,
    config: {
      errorTrackingSentryAuthToken: "sentry-token",
      errorTrackingSentryOrganizationSlug: "acme",
    },
  });

  assert.equal(platform.provider, ERROR_TRACKING_PROVIDERS.sentry);
  assert.equal(typeof platform.createIssueClient, "function");
});

test("sentry error tracking provider returns null client when auth is missing", () => {
  const platform = createErrorTrackingPlatform({
    provider: ERROR_TRACKING_PROVIDERS.sentry,
    config: {
      errorTrackingSentryAuthToken: "",
      errorTrackingSentryOrganizationSlug: "acme",
    },
  });

  assert.equal(platform.createIssueClient(), null);
});

test("createErrorTrackingPlatform rejects unknown providers", () => {
  assert.throws(
    () => createErrorTrackingPlatform({ provider: "unknown", config: {} }),
    /Unsupported error tracking provider: unknown/,
  );
});
