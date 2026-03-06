const assert = require("node:assert/strict");
const test = require("node:test");

const { AI_PROVIDERS } = require("../../src/config");
const { createAiPlatform } = require("../../src/platform/ai/factory");

test("createAiPlatform builds openai provider", () => {
  const platform = createAiPlatform({
    provider: AI_PROVIDERS.openai,
    config: {
      aiOpenAiApiKey: "openai-key",
      aiOpenAiModel: "gpt-4.1-mini",
    },
  });

  assert.equal(platform.provider, AI_PROVIDERS.openai);
  assert.equal(typeof platform.createAiClient, "function");
});

test("openai ai provider returns null client when auth is missing", () => {
  const platform = createAiPlatform({
    provider: AI_PROVIDERS.openai,
    config: {
      aiOpenAiApiKey: "",
      aiOpenAiModel: "gpt-4.1-mini",
    },
  });

  assert.equal(platform.createAiClient(), null);
});

test("createAiPlatform builds anthropic provider", () => {
  const platform = createAiPlatform({
    provider: AI_PROVIDERS.anthropic,
    config: {
      aiAnthropicApiKey: "anthropic-key",
      aiAnthropicModel: "claude-3-7-sonnet",
    },
  });

  assert.equal(platform.provider, AI_PROVIDERS.anthropic);
  assert.equal(typeof platform.createAiClient, "function");
});

test("anthropic ai provider returns null client when auth is missing", () => {
  const platform = createAiPlatform({
    provider: AI_PROVIDERS.anthropic,
    config: {
      aiAnthropicApiKey: "",
      aiAnthropicModel: "claude-3-7-sonnet",
    },
  });

  assert.equal(platform.createAiClient(), null);
});

test("createAiPlatform rejects unknown providers", () => {
  assert.throws(
    () => createAiPlatform({ provider: "unknown", config: {} }),
    /Unsupported ai provider: unknown/,
  );
});
