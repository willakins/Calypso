const { BaseAiPlatform } = require("../../base_ai_platform");
const { createOpenAiClient } = require("./client");

class OpenAiPlatform extends BaseAiPlatform {
  constructor({ config }) {
    super({ provider: "openai" });
    this.config = config;
  }

  createAiClient() {
    return createOpenAiClient({ config: this.config });
  }
}

module.exports = {
  OpenAiPlatform,
};
