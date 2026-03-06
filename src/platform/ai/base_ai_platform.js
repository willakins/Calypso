class BaseAiPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  createAiClient() {
    throw new Error(`${this.provider} ai platform must implement createAiClient().`);
  }
}

module.exports = {
  BaseAiPlatform,
};
