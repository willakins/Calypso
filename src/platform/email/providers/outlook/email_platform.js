const { BaseEmailPlatform } = require("../../base_email_platform");
const { createOutlookClient } = require("./client");

class OutlookEmailPlatform extends BaseEmailPlatform {
  constructor({ config }) {
    super({ provider: "outlook" });
    this.config = config;
  }

  createEmailClient() {
    return createOutlookClient({ config: this.config });
  }
}

module.exports = {
  OutlookEmailPlatform,
};
