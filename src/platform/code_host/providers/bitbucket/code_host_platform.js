const { createBitbucketClient } = require("./client");
const { registerBitbucketWebhook } = require("./webhook");
const { BaseCodeHostPlatform } = require("../../base_code_host_platform");

class BitbucketCodeHostPlatform extends BaseCodeHostPlatform {
  constructor({ config }) {
    super({ provider: "bitbucket" });
    this.config = config;
  }

  createSyncClient() {
    const codeHostToken = this.config.codeHostToken;
    if (!codeHostToken) {
      return null;
    }

    return createBitbucketClient({
      apiBaseUrl: this.config.codeHostApiBaseUrl,
      apiMaxPages: this.config.codeHostApiMaxPages,
      apiPageSize: this.config.codeHostApiPageSize,
      apiUserAgent: this.config.codeHostApiUserAgent,
      token: codeHostToken,
    });
  }

  registerWebhookRoutes(httpApp, { pool }) {
    registerBitbucketWebhook(httpApp, {
      pool,
      bitbucket: {
        mainBranch: this.config.codeHostMainBranch,
        repositoryFullName: this.config.codeHostRepository,
        webhookSecret: this.config.codeHostWebhookSecret,
      },
      logger: console,
      paths: ["/bitbucket/webhook", "/codehost/webhook"],
    });
  }
}

module.exports = {
  BitbucketCodeHostPlatform,
};
