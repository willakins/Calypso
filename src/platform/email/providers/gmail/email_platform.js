const { BaseEmailPlatform } = require("../../base_email_platform");
const { createGmailClient } = require("./client");
const { registerGmailWebhook } = require("./webhook");

class GmailEmailPlatform extends BaseEmailPlatform {
  constructor({ config }) {
    super({ provider: "gmail" });
    this.config = config;
  }

  createEmailClient() {
    return createGmailClient({ config: this.config });
  }

  registerWebhookRoutes(httpApp, options = {}) {
    if (!String(this.config?.emailGmailAddress || "").trim()) {
      return;
    }

    registerGmailWebhook(httpApp, {
      config: this.config,
      ...options,
    });
  }
}

module.exports = {
  GmailEmailPlatform,
};
