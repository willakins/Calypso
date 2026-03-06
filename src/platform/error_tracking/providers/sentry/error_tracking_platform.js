const { BaseErrorTrackingPlatform } = require("../../base_error_tracking_platform");
const { createSentryClient } = require("./client");

class SentryErrorTrackingPlatform extends BaseErrorTrackingPlatform {
  constructor({ config }) {
    super({ provider: "sentry" });
    this.config = config;
  }

  createIssueClient() {
    return createSentryClient({
      authToken: this.config.errorTrackingSentryAuthToken,
      baseUrl: this.config.errorTrackingSentryBaseUrl,
      organizationSlug: this.config.errorTrackingSentryOrganizationSlug,
    });
  }
}

module.exports = {
  SentryErrorTrackingPlatform,
};
