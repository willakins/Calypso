const dotenv = require("dotenv");

dotenv.config();

const REQUIRED_ENVIRONMENT_VARIABLES = [
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "DATABASE_URL",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_REPO",
  "GITHUB_MAIN_BRANCH",
];
const DEFAULT_GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS = 24;
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_GITHUB_API_PAGE_SIZE = 100;
const DEFAULT_GITHUB_API_MAX_PAGES = 100;
const DEFAULT_GITHUB_API_USER_AGENT = "calypso-bot";

function loadConfig() {
  assertRequiredEnvironmentVariablesExist(REQUIRED_ENVIRONMENT_VARIABLES);

  return {
    databaseUrl: readRequiredEnvironmentVariable("DATABASE_URL"),
    doDeployPollIntervalSeconds: readPositiveInteger("DO_DEPLOY_POLL_INTERVAL_SECONDS", 10),
    doDeployTimeoutSeconds: readPositiveInteger("DO_DEPLOY_TIMEOUT_SECONDS", 1200),
    digitaloceanToken: readOptionalEnvironmentVariable("DIGITALOCEAN_TOKEN"),
    doAppIdProd: readOptionalEnvironmentVariable("DO_APP_ID_PROD"),
    githubOpenPrSyncIntervalHours: readPositiveInteger(
      "GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS",
      DEFAULT_GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS,
    ),
    githubApiBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
    githubApiVersion: DEFAULT_GITHUB_API_VERSION,
    githubApiPageSize: DEFAULT_GITHUB_API_PAGE_SIZE,
    githubApiMaxPages: DEFAULT_GITHUB_API_MAX_PAGES,
    githubApiUserAgent: DEFAULT_GITHUB_API_USER_AGENT,
    githubMainBranch: readRequiredEnvironmentVariable("GITHUB_MAIN_BRANCH"),
    githubRepo: readRequiredEnvironmentVariable("GITHUB_REPO"),
    githubToken: readOptionalEnvironmentVariable("GITHUB_TOKEN"),
    githubWebhookSecret: readRequiredEnvironmentVariable("GITHUB_WEBHOOK_SECRET"),
    port: readPortNumber("PORT", 3000),
    slackBotToken: readRequiredEnvironmentVariable("SLACK_BOT_TOKEN"),
    slackAppToken: readRequiredEnvironmentVariable("SLACK_APP_TOKEN"),
  };
}

function assertRequiredEnvironmentVariablesExist(requiredNames) {
  const missingEnvironmentVariables = requiredNames.filter(
    (name) => readOptionalEnvironmentVariable(name) === "",
  );

  if (missingEnvironmentVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );
  }
}

function readRequiredEnvironmentVariable(name) {
  const value = readOptionalEnvironmentVariable(name);
  if (value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnvironmentVariable(name) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

function readPortNumber(name, fallbackPort) {
  const value = readOptionalEnvironmentVariable(name);
  if (value === "") {
    return fallbackPort;
  }

  const parsedPort = Number(value);
  const isValidPort = Number.isInteger(parsedPort) && parsedPort > 0;
  if (!isValidPort) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedPort;
}

function readPositiveInteger(name, fallbackValue) {
  const value = readOptionalEnvironmentVariable(name);
  if (value === "") {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

module.exports = {
  DEFAULT_GITHUB_API_BASE_URL,
  DEFAULT_GITHUB_API_MAX_PAGES,
  DEFAULT_GITHUB_API_PAGE_SIZE,
  DEFAULT_GITHUB_API_USER_AGENT,
  DEFAULT_GITHUB_API_VERSION,
  DEFAULT_GITHUB_OPEN_PR_SYNC_INTERVAL_HOURS,
  loadConfig,
};
