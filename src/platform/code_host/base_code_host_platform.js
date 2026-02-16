class BaseCodeHostPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  createSyncClient() {
    throw new Error(`${this.provider} code-host platform must implement createSyncClient().`);
  }

  registerWebhookRoutes(_httpApp, _options) {
    throw new Error(`${this.provider} code-host platform must implement registerWebhookRoutes().`);
  }
}

module.exports = {
  BaseCodeHostPlatform,
};
