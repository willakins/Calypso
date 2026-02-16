const assert = require("node:assert/strict");
const test = require("node:test");

const { loadConfig } = require("../src/config");

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/calypso",
  GITHUB_MAIN_BRANCH: "main",
  GITHUB_REPO: "croft-eng/croft",
  GITHUB_WEBHOOK_SECRET: "secret",
  SLACK_APP_TOKEN: "xapp-test",
  SLACK_BOT_TOKEN: "xoxb-test",
};

test("loadConfig throws when required values are missing", { concurrency: false }, () => {
  withEnvironment(
    {
      DATABASE_URL: "",
      GITHUB_MAIN_BRANCH: "",
      GITHUB_REPO: "",
      GITHUB_WEBHOOK_SECRET: "",
      SLACK_APP_TOKEN: "",
      SLACK_BOT_TOKEN: "",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /Missing required environment variables: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, DATABASE_URL, GITHUB_WEBHOOK_SECRET, GITHUB_REPO, GITHUB_MAIN_BRANCH/,
      );
    },
  );
});

test("loadConfig reads required and optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DO_DEPLOY_POLL_INTERVAL_SECONDS: "15",
      DO_DEPLOY_TIMEOUT_SECONDS: "900",
      DIGITALOCEAN_TOKEN: "  do-token  ",
      DO_APP_ID_PROD: "  app-id  ",
      GITHUB_TOKEN: undefined,
      PORT: "4100",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.slackBotToken, "xoxb-test");
      assert.equal(config.slackAppToken, "xapp-test");
      assert.equal(config.databaseUrl, REQUIRED_ENV.DATABASE_URL);
      assert.equal(config.githubWebhookSecret, "secret");
      assert.equal(config.githubRepo, "croft-eng/croft");
      assert.equal(config.githubMainBranch, "main");
      assert.equal(config.githubToken, "");
      assert.equal(config.githubOpenPrSyncIntervalHours, 24);
      assert.equal(config.githubApiBaseUrl, "https://api.github.com");
      assert.equal(config.githubApiVersion, "2022-11-28");
      assert.equal(config.githubApiPageSize, 100);
      assert.equal(config.githubApiMaxPages, 100);
      assert.equal(config.githubApiUserAgent, "calypso-bot");
      assert.equal(config.doDeployPollIntervalSeconds, 15);
      assert.equal(config.doDeployTimeoutSeconds, 900);
      assert.equal(config.digitaloceanToken, "do-token");
      assert.equal(config.doAppIdProd, "app-id");
      assert.equal(config.port, 4100);
    },
  );
});

test("loadConfig uses defaults for optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DO_DEPLOY_POLL_INTERVAL_SECONDS: undefined,
      DO_DEPLOY_TIMEOUT_SECONDS: undefined,
      DIGITALOCEAN_TOKEN: undefined,
      DO_APP_ID_PROD: undefined,
      GITHUB_TOKEN: undefined,
      PORT: undefined,
    },
    () => {
      const config = loadConfig();

      assert.equal(config.doDeployPollIntervalSeconds, 10);
      assert.equal(config.doDeployTimeoutSeconds, 1200);
      assert.equal(config.digitaloceanToken, "");
      assert.equal(config.doAppIdProd, "");
      assert.equal(config.githubToken, "");
      assert.equal(config.githubOpenPrSyncIntervalHours, 24);
      assert.equal(config.githubApiBaseUrl, "https://api.github.com");
      assert.equal(config.githubApiVersion, "2022-11-28");
      assert.equal(config.githubApiPageSize, 100);
      assert.equal(config.githubApiMaxPages, 100);
      assert.equal(config.githubApiUserAgent, "calypso-bot");
      assert.equal(config.port, 3000);
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
      DO_DEPLOY_POLL_INTERVAL_SECONDS: "-1",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /DO_DEPLOY_POLL_INTERVAL_SECONDS must be a positive integer/,
      );
    },
  );
});

test("loadConfig reads GitHub sync optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      GITHUB_TOKEN: "  ghp-token  ",
      GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS: "12",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.githubToken, "ghp-token");
      assert.equal(config.githubOpenPrSyncIntervalHours, 12);
    },
  );
});

test("loadConfig rejects invalid GitHub sync interval", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS: "0",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS must be a positive integer/,
      );
    },
  );
});

function withEnvironment(overrides, fn) {
  const originalEnvironment = process.env;
  process.env = { ...originalEnvironment };

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
