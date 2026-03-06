class BaseEmailPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  createEmailClient() {
    throw new Error(`${this.provider} email platform must implement createEmailClient().`);
  }

  registerWebhookRoutes(_httpApp, _options = {}) {
    return;
  }
}

module.exports = {
  BaseEmailPlatform,
};
