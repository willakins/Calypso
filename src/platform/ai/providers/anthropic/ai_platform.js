const { BaseAiPlatform } = require("../../base_ai_platform");
const { createAnthropicClient } = require("./client");

class AnthropicAiPlatform extends BaseAiPlatform {
  constructor({ config }) {
    super({ provider: "anthropic" });
    this.config = config;
  }

  createAiClient() {
    return createAnthropicClient({ config: this.config });
  }
}

module.exports = {
  AnthropicAiPlatform,
};
