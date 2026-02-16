const assert = require("node:assert/strict");
const test = require("node:test");

const { COMMUNICATION_PROVIDERS } = require("../src/config");
const { createCommunicationPlatform } = require("../src/platform/communication/factory");

test("createCommunicationPlatform builds microsoft teams provider", () => {
  const platform = createCommunicationPlatform({
    provider: COMMUNICATION_PROVIDERS.microsoftTeams,
    config: {},
  });

  assert.ok(platform);
  assert.equal(platform.provider, COMMUNICATION_PROVIDERS.microsoftTeams);
});

test("createCommunicationPlatform rejects unknown providers", () => {
  assert.throws(
    () => createCommunicationPlatform({ provider: "unknown", config: {} }),
    /Unsupported communication provider: unknown/,
  );
});
