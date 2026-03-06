class BaseErrorTrackingPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  createIssueClient() {
    throw new Error(`${this.provider} error-tracking platform must implement createIssueClient().`);
  }
}

module.exports = {
  BaseErrorTrackingPlatform,
};
