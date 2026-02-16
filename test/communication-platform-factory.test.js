const assert = require("node:assert/strict");
const test = require("node:test");

const { COMMUNICATION_PROVIDERS } = require("../src/config");
const { createCommunicationPlatform } = require("../src/platform/communication/factory");

test("createCommunicationPlatform fails fast for microsoft teams", () => {
  assert.throws(
    () => createCommunicationPlatform({
      provider: COMMUNICATION_PROVIDERS.microsoftTeams,
      config: {},
    }),
    /Provider 'microsoft_teams' for communication is not implemented/,
  );
});

test("createCommunicationPlatform rejects unknown providers", () => {
  assert.throws(
    () => createCommunicationPlatform({ provider: "unknown", config: {} }),
    /Unsupported communication provider: unknown/,
  );
});
