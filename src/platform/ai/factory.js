const { AI_PROVIDERS, DEFAULT_AI_PROVIDER } = require("../../config");
const { AnthropicAiPlatform } = require("./providers/anthropic/ai_platform");
const { OpenAiPlatform } = require("./providers/openai/ai_platform");

const AI_PLATFORM_BUILDERS = Object.freeze({
  [AI_PROVIDERS.openai]: ({ config }) => new OpenAiPlatform({ config }),
  [AI_PROVIDERS.anthropic]: ({ config }) => new AnthropicAiPlatform({ config }),
});

function createAiPlatform(options = {}) {
  const provider = options.provider || DEFAULT_AI_PROVIDER;
  const buildPlatform = AI_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported ai provider: ${provider}`);
  }

  const platform = buildPlatform({ config: options.config || {} });
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createAiPlatform,
};
