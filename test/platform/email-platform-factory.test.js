const assert = require("node:assert/strict");
const test = require("node:test");

const { EMAIL_PROVIDERS } = require("../../src/config");
const { createEmailPlatform } = require("../../src/platform/email/factory");

test("createEmailPlatform builds gmail provider", () => {
  const platform = createEmailPlatform({
    provider: EMAIL_PROVIDERS.gmail,
    config: {},
  });

  assert.equal(platform.provider, EMAIL_PROVIDERS.gmail);
  assert.equal(typeof platform.createEmailClient, "function");
});

test("createEmailPlatform builds outlook provider", () => {
  const platform = createEmailPlatform({
    provider: EMAIL_PROVIDERS.outlook,
    config: {},
  });

  assert.equal(platform.provider, EMAIL_PROVIDERS.outlook);
  assert.equal(typeof platform.createEmailClient, "function");
});

test("createEmailPlatform rejects unknown providers", () => {
  assert.throws(
    () => createEmailPlatform({ provider: "unknown", config: {} }),
    /Unsupported email provider: unknown/,
  );
});
