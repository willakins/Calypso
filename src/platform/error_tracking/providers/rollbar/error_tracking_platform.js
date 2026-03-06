const { BaseErrorTrackingPlatform } = require("../../base_error_tracking_platform");
const { createRollbarClient } = require("./client");

class RollbarErrorTrackingPlatform extends BaseErrorTrackingPlatform {
  constructor({ config }) {
    super({ provider: "rollbar" });
    this.config = config;
  }

  createIssueClient() {
    return createRollbarClient({
      accessToken: this.config.errorTrackingRollbarAccessToken,
      baseUrl: this.config.errorTrackingRollbarBaseUrl,
    });
  }
}

module.exports = {
  RollbarErrorTrackingPlatform,
};
