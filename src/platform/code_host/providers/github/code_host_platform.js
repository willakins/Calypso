const { createGithubClient } = require("./client");
const { registerGithubWebhook } = require("./webhook");
const { BaseCodeHostPlatform } = require("../../base_code_host_platform");

class GithubCodeHostPlatform extends BaseCodeHostPlatform {
  constructor({ config }) {
    super({ provider: "github" });
    this.config = config;
  }

  createSyncClient() {
    const codeHostToken = this.config.codeHostToken || this.config.githubToken;
    if (!codeHostToken) {
      return null;
    }

    return createGithubClient({
      apiBaseUrl: this.config.codeHostApiBaseUrl || this.config.githubApiBaseUrl,
      apiMaxPages: this.config.codeHostApiMaxPages || this.config.githubApiMaxPages,
      apiPageSize: this.config.codeHostApiPageSize || this.config.githubApiPageSize,
      apiUserAgent: this.config.codeHostApiUserAgent || this.config.githubApiUserAgent,
      apiVersion: this.config.codeHostApiVersion || this.config.githubApiVersion,
      token: codeHostToken,
    });
  }

  registerWebhookRoutes(httpApp, { pool }) {
    registerGithubWebhook(httpApp, {
      pool,
      github: {
        mainBranch: this.config.codeHostMainBranch || this.config.githubMainBranch,
        repositoryFullName: this.config.codeHostRepository || this.config.githubRepo,
        webhookSecret: this.config.codeHostWebhookSecret || this.config.githubWebhookSecret,
      },
      paths: ["/github/webhook", "/codehost/webhook"],
    });
  }
}

module.exports = {
  GithubCodeHostPlatform,
};
