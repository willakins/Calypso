const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEFAULT_CODE_HOST_PROVIDER,
  DEFAULT_COMMUNICATION_PROVIDER,
  DEFAULT_DEPLOY_PROVIDER,
  DEPLOY_PROVIDERS,
  loadConfig,
} = require("../../src/config");

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/calypso",
  CODE_HOST_MAIN_BRANCH: "main",
  CODE_HOST_REPOSITORY: "croft-eng/croft",
  CODE_HOST_WEBHOOK_SECRET: "secret",
  COMMUNICATION_APP_TOKEN: "xapp-test",
  COMMUNICATION_BOT_TOKEN: "xoxb-test",
};

test("loadConfig throws when required values are missing", { concurrency: false }, () => {
  withEnvironment(
    {
      DATABASE_URL: "",
      CODE_HOST_MAIN_BRANCH: "",
      CODE_HOST_REPOSITORY: "",
      CODE_HOST_WEBHOOK_SECRET: "",
      COMMUNICATION_APP_TOKEN: "",
      COMMUNICATION_BOT_TOKEN: "",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /Missing required environment variables: DATABASE_URL, COMMUNICATION_BOT_TOKEN, COMMUNICATION_APP_TOKEN, CODE_HOST_WEBHOOK_SECRET, CODE_HOST_REPOSITORY, CODE_HOST_MAIN_BRANCH/,
      );
    },
  );
});

test("loadConfig defaults provider selections", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: undefined,
      CODE_HOST_PROVIDER: undefined,
      DEPLOY_PROVIDER: undefined,
      BOT_NAME: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.botName, "Calypso");
      assert.equal(config.communicationProvider, DEFAULT_COMMUNICATION_PROVIDER);
      assert.equal(config.codeHostProvider, DEFAULT_CODE_HOST_PROVIDER);
      assert.equal(config.deployProvider, DEFAULT_DEPLOY_PROVIDER);
    },
  );
});

test("loadConfig reads required and optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: "slack",
      CODE_HOST_PROVIDER: "github",
      DEPLOY_PROVIDER: "digitalocean",
      DEPLOY_POLL_INTERVAL_SECONDS: "15",
      DEPLOY_TIMEOUT_SECONDS: "900",
      DEPLOY_TOKEN: "  do-token  ",
      DEPLOY_PROD_APP_ID: "  app-id  ",
      DEPLOY_STAGING_APP_ID: "  staging-app-id  ",
      DEPLOY_REGION: " us-west-2 ",
      DEPLOY_ACCESS_KEY_ID: " AKIA123 ",
      DEPLOY_SECRET_ACCESS_KEY: " secret-123 ",
      DEPLOY_SESSION_TOKEN: " session-123 ",
      CODE_HOST_TOKEN: undefined,
      BOT_NAME: "  Voyager  ",
      PORT: "4100",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.botName, "Voyager");
      assert.equal(config.communicationProvider, COMMUNICATION_PROVIDERS.slack);
      assert.equal(config.codeHostProvider, CODE_HOST_PROVIDERS.github);
      assert.equal(config.deployProvider, DEPLOY_PROVIDERS.digitalocean);
      assert.equal(config.communicationBotToken, "xoxb-test");
      assert.equal(config.communicationAppToken, "xapp-test");
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.databaseUrl, REQUIRED_ENV.DATABASE_URL);
      assert.equal(config.codeHostWebhookSecret, "secret");
      assert.equal(config.codeHostRepository, "croft-eng/croft");
      assert.equal(config.codeHostMainBranch, "main");
      assert.equal(config.codeHostToken, "");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 24);
      assert.equal(config.codexApprovalPollIntervalMinutes, 5);
      assert.equal(config.codeHostApiBaseUrl, "https://api.github.com");
      assert.equal(config.codeHostApiVersion, "2022-11-28");
      assert.equal(config.codeHostApiPageSize, 100);
      assert.equal(config.codeHostApiMaxPages, 100);
      assert.equal(config.codeHostApiUserAgent, "calypso-bot");
      assert.equal(config.deployPollIntervalSeconds, 15);
      assert.equal(config.deployTimeoutSeconds, 900);
      assert.equal(config.deployToken, "do-token");
      assert.equal(config.deployProductionAppId, "app-id");
      assert.equal(config.deployStagingAppId, "staging-app-id");
      assert.equal(config.deployRegion, "us-west-2");
      assert.equal(config.deployAccessKeyId, "AKIA123");
      assert.equal(config.deploySecretAccessKey, "secret-123");
      assert.equal(config.deploySessionToken, "session-123");
      assert.equal(config.environmentStatusPollIntervalSeconds, 60);
      assert.equal(config.environmentStatusTimeoutSeconds, 10);
      assert.equal(config.emailGmailAddress, "");
      assert.equal(config.emailGmailClientId, "");
      assert.equal(config.emailGmailClientSecret, "");
      assert.equal(config.emailGmailRefreshToken, "");
      assert.equal(config.emailGmailPubsubTopic, "");
      assert.equal(config.emailWebhookAudience, "");
      assert.equal(config.emailPushServiceAccountEmail, "");
      assert.equal(config.emailWatchRenewIntervalHours, 24);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 5);
      assert.equal(config.port, 4100);
    },
  );
});

test("loadConfig supports non-default provider selections without requiring unrelated provider env vars", { concurrency: false }, () => {
  withEnvironment(
    {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/calypso",
      COMMUNICATION_PROVIDER: "microsoft_teams",
      CODE_HOST_PROVIDER: "bitbucket",
      DEPLOY_PROVIDER: "aws",
      CODE_HOST_MAIN_BRANCH: "main",
      CODE_HOST_REPOSITORY: "workspace/repo",
      CODE_HOST_WEBHOOK_SECRET: "secret",
      COMMUNICATION_APP_TOKEN: undefined,
      COMMUNICATION_BOT_TOKEN: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.communicationProvider, COMMUNICATION_PROVIDERS.microsoftTeams);
      assert.equal(config.codeHostProvider, CODE_HOST_PROVIDERS.bitbucket);
      assert.equal(config.deployProvider, DEPLOY_PROVIDERS.aws);
      assert.equal(config.communicationBotToken, "");
      assert.equal(config.communicationAppToken, "");
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.codeHostWebhookSecret, "secret");
      assert.equal(config.codeHostRepository, "workspace/repo");
      assert.equal(config.codeHostMainBranch, "main");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
    },
  );
});

test("loadConfig rejects unknown communication provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: "irc",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /COMMUNICATION_PROVIDER must be one of: slack, microsoft_teams/,
      );
    },
  );
});

test("loadConfig rejects unknown code-host provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_PROVIDER: "azure_devops",
    },
    () => {
      assert.throws(() => loadConfig(), /CODE_HOST_PROVIDER must be one of: github, bitbucket/);
    },
  );
});

test("loadConfig rejects unknown deploy provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_PROVIDER: "render",
    },
    () => {
      assert.throws(() => loadConfig(), /DEPLOY_PROVIDER must be one of: digitalocean, aws/);
    },
  );
});

test("loadConfig uses defaults for optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_POLL_INTERVAL_SECONDS: undefined,
      DEPLOY_TIMEOUT_SECONDS: undefined,
      DEPLOY_TOKEN: undefined,
      DEPLOY_PROD_APP_ID: undefined,
      DEPLOY_STAGING_APP_ID: undefined,
      DEPLOY_REGION: undefined,
      DEPLOY_ACCESS_KEY_ID: undefined,
      DEPLOY_SECRET_ACCESS_KEY: undefined,
      DEPLOY_SESSION_TOKEN: undefined,
      ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS: undefined,
      ENVIRONMENT_STATUS_TIMEOUT_SECONDS: undefined,
      EMAIL_GMAIL_ADDRESS: undefined,
      EMAIL_GMAIL_CLIENT_ID: undefined,
      EMAIL_GMAIL_CLIENT_SECRET: undefined,
      EMAIL_GMAIL_REFRESH_TOKEN: undefined,
      EMAIL_GMAIL_PUBSUB_TOPIC: undefined,
      EMAIL_WEBHOOK_AUDIENCE: undefined,
      EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: undefined,
      EMAIL_WATCH_RENEW_INTERVAL_HOURS: undefined,
      EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES: undefined,
      CODE_HOST_TOKEN: undefined,
      PORT: undefined,
    },
    () => {
      const config = loadConfig();

      assert.equal(config.deployPollIntervalSeconds, 10);
      assert.equal(config.deployTimeoutSeconds, 1200);
      assert.equal(config.deployToken, "");
      assert.equal(config.deployProductionAppId, "");
      assert.equal(config.deployStagingAppId, "");
      assert.equal(config.deployRegion, "us-east-1");
      assert.equal(config.deployAccessKeyId, "");
      assert.equal(config.deploySecretAccessKey, "");
      assert.equal(config.deploySessionToken, "");
      assert.equal(config.environmentStatusPollIntervalSeconds, 60);
      assert.equal(config.environmentStatusTimeoutSeconds, 10);
      assert.equal(config.emailGmailAddress, "");
      assert.equal(config.emailGmailClientId, "");
      assert.equal(config.emailGmailClientSecret, "");
      assert.equal(config.emailGmailRefreshToken, "");
      assert.equal(config.emailGmailPubsubTopic, "");
      assert.equal(config.emailWebhookAudience, "");
      assert.equal(config.emailPushServiceAccountEmail, "");
      assert.equal(config.emailWatchRenewIntervalHours, 24);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 5);
      assert.equal(config.codeHostToken, "");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 24);
      assert.equal(config.codexApprovalPollIntervalMinutes, 5);
      assert.equal(config.codeHostApiBaseUrl, "https://api.github.com");
      assert.equal(config.codeHostApiVersion, "2022-11-28");
      assert.equal(config.codeHostApiPageSize, 100);
      assert.equal(config.codeHostApiMaxPages, 100);
      assert.equal(config.codeHostApiUserAgent, "calypso-bot");
      assert.equal(config.port, 3001);
    },
  );
});

test("loadConfig rejects invalid port", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      PORT: "not-a-number",
    },
    () => {
      assert.throws(() => loadConfig(), /PORT must be a positive integer/);
    },
  );
});

test("loadConfig rejects invalid DO polling values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_POLL_INTERVAL_SECONDS: "-1",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /DEPLOY_POLL_INTERVAL_SECONDS must be a positive integer/,
      );
    },
  );
});

test("loadConfig reads GitHub sync optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_TOKEN: "  ghp-token  ",
      CODE_HOST_CODEX_USER_LOGINS: " codex-bot , codex[bot] ",
      CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS: "12",
      CODEX_APPROVAL_POLL_INTERVAL_MINUTES: "7",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.codeHostToken, "ghp-token");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex-bot", "codex[bot]"]);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 12);
      assert.equal(config.codexApprovalPollIntervalMinutes, 7);
    },
  );
});

test("loadConfig rejects invalid GitHub sync interval", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS: "0",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS must be a positive integer/,
      );
    },
  );
});

test("loadConfig rejects invalid codex approval poll interval", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODEX_APPROVAL_POLL_INTERVAL_MINUTES: "0",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /CODEX_APPROVAL_POLL_INTERVAL_MINUTES must be a positive integer/,
      );
    },
  );
});

test("loadConfig reads microsoft teams optional communication values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_WEBHOOK_URL: "  https://example.test/hook  ",
      COMMUNICATION_COMMAND_PATH: " teams/calypso ",
      COMMUNICATION_ADMIN_USER_IDS: " U1 ,U2, U3 ",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.communicationWebhookUrl, "https://example.test/hook");
      assert.equal(config.communicationCommandPath, "teams/calypso");
      assert.deepEqual(config.communicationAdminUserIds, ["U1", "U2", "U3"]);
    },
  );
});

test("loadConfig reads optional environment status and email polling values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS: "30",
      ENVIRONMENT_STATUS_TIMEOUT_SECONDS: "8",
      EMAIL_GMAIL_ADDRESS: " support@example.com ",
      EMAIL_GMAIL_CLIENT_ID: " gmail-client-id ",
      EMAIL_GMAIL_CLIENT_SECRET: " gmail-client-secret ",
      EMAIL_GMAIL_REFRESH_TOKEN: " gmail-refresh-token ",
      EMAIL_GMAIL_PUBSUB_TOPIC: " projects/test/topics/calypso-support ",
      EMAIL_WEBHOOK_AUDIENCE: " https://example.com/email/webhook ",
      EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: " pubsub@example.iam.gserviceaccount.com ",
      EMAIL_WATCH_RENEW_INTERVAL_HOURS: "12",
      EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES: "9",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.environmentStatusPollIntervalSeconds, 30);
      assert.equal(config.environmentStatusTimeoutSeconds, 8);
      assert.equal(config.emailGmailAddress, "support@example.com");
      assert.equal(config.emailGmailClientId, "gmail-client-id");
      assert.equal(config.emailGmailClientSecret, "gmail-client-secret");
      assert.equal(config.emailGmailRefreshToken, "gmail-refresh-token");
      assert.equal(config.emailGmailPubsubTopic, "projects/test/topics/calypso-support");
      assert.equal(config.emailWebhookAudience, "https://example.com/email/webhook");
      assert.equal(
        config.emailPushServiceAccountEmail,
        "pubsub@example.iam.gserviceaccount.com",
      );
      assert.equal(config.emailWatchRenewIntervalHours, 12);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 9);
    },
  );
});

function withEnvironment(overrides, fn) {
  const originalEnvironment = process.env;
  process.env = { ...originalEnvironment };
  const managedEnvironmentKeys = [
    "DATABASE_URL",
    "COMMUNICATION_PROVIDER",
    "CODE_HOST_PROVIDER",
    "DEPLOY_PROVIDER",
    "COMMUNICATION_BOT_TOKEN",
    "COMMUNICATION_APP_TOKEN",
    "COMMUNICATION_WEBHOOK_URL",
    "COMMUNICATION_COMMAND_PATH",
    "COMMUNICATION_ADMIN_USER_IDS",
    "CODE_HOST_WEBHOOK_SECRET",
    "CODE_HOST_REPOSITORY",
    "CODE_HOST_MAIN_BRANCH",
    "CODE_HOST_TOKEN",
    "CODE_HOST_CODEX_USER_LOGINS",
    "CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS",
    "CODEX_APPROVAL_POLL_INTERVAL_MINUTES",
    "DEPLOY_POLL_INTERVAL_SECONDS",
    "DEPLOY_TIMEOUT_SECONDS",
    "DEPLOY_TOKEN",
    "DEPLOY_PROD_APP_ID",
    "DEPLOY_STAGING_APP_ID",
    "DEPLOY_REGION",
    "DEPLOY_ACCESS_KEY_ID",
    "DEPLOY_SECRET_ACCESS_KEY",
    "DEPLOY_SESSION_TOKEN",
    "BOT_NAME",
    "PORT",
  ];
  for (const key of managedEnvironmentKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    process.env = originalEnvironment;
  }
}
