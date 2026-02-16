const assert = require("node:assert/strict");
const test = require("node:test");

const { DEPLOY_PROVIDERS } = require("../../src/config");
const { createDeployPlatform } = require("../../src/platform/deploy/factory");

test("createDeployPlatform builds digitalocean provider", () => {
  const platform = createDeployPlatform({ provider: DEPLOY_PROVIDERS.digitalocean });

  assert.equal(typeof platform.triggerProductionDeployment, "function");
  assert.equal(typeof platform.waitForProductionDeploymentCompletion, "function");
});

test("createDeployPlatform builds aws provider", () => {
  const platform = createDeployPlatform({ provider: DEPLOY_PROVIDERS.aws });

  assert.equal(typeof platform.triggerProductionDeployment, "function");
  assert.equal(typeof platform.waitForProductionDeploymentCompletion, "function");
});

test("createDeployPlatform rejects unknown providers", () => {
  assert.throws(
    () => createDeployPlatform({ provider: "unknown" }),
    /Unsupported deploy provider: unknown/,
  );
});
