const dotenv = require("dotenv");

dotenv.config();

const COMMUNICATION_PROVIDERS = Object.freeze({
  slack: "slack",
  microsoftTeams: "microsoft_teams",
});
const CODE_HOST_PROVIDERS = Object.freeze({
  github: "github",
  bitbucket: "bitbucket",
});
const DEPLOY_PROVIDERS = Object.freeze({
  digitalocean: "digitalocean",
  aws: "aws",
});
const DEFAULT_COMMUNICATION_PROVIDER = COMMUNICATION_PROVIDERS.slack;
const DEFAULT_CODE_HOST_PROVIDER = CODE_HOST_PROVIDERS.github;
const DEFAULT_DEPLOY_PROVIDER = DEPLOY_PROVIDERS.digitalocean;
const DEFAULT_BOT_NAME = "Calypso";
const DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS = 24;
const DEFAULT_COMMUNICATION_COMMAND_PATH = "/communication/commands";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_BITBUCKET_API_BASE_URL = "https://api.bitbucket.org/2.0";
const DEFAULT_CODE_HOST_API_VERSION = "2022-11-28";
const DEFAULT_CODE_HOST_API_PAGE_SIZE = 100;
const DEFAULT_CODE_HOST_API_MAX_PAGES = 100;
const DEFAULT_CODE_HOST_API_USER_AGENT = "calypso-bot";
const DEFAULT_CODE_HOST_CODEX_USER_LOGINS = Object.freeze(["codex", "codex[bot]"]);
const DEFAULT_DEPLOY_REGION = "us-east-1";
const DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES = 5;

function loadConfig() {
  const communicationProvider = readProviderSelection(
    "COMMUNICATION_PROVIDER",
    DEFAULT_COMMUNICATION_PROVIDER,
    Object.values(COMMUNICATION_PROVIDERS),
  );
  const codeHostProvider = readProviderSelection(
    "CODE_HOST_PROVIDER",
    DEFAULT_CODE_HOST_PROVIDER,
    Object.values(CODE_HOST_PROVIDERS),
  );
  const deployProvider = readProviderSelection(
    "DEPLOY_PROVIDER",
    DEFAULT_DEPLOY_PROVIDER,
    Object.values(DEPLOY_PROVIDERS),
  );

  assertRequiredEnvironmentVariablesExist(
    buildRequiredEnvironmentVariables({ communicationProvider, codeHostProvider }),
  );

  const communicationBotToken = readCommunicationValue({
    communicationProvider,
    name: "COMMUNICATION_BOT_TOKEN",
  });
  const communicationAppToken = readCommunicationValue({
    communicationProvider,
    name: "COMMUNICATION_APP_TOKEN",
  });
  const communicationWebhookUrl = readOptionalEnvironmentValue("COMMUNICATION_WEBHOOK_URL");
  const communicationCommandPath =
    readOptionalEnvironmentValue("COMMUNICATION_COMMAND_PATH") ||
    DEFAULT_COMMUNICATION_COMMAND_PATH;
  const communicationAdminUserIds = readCommaSeparatedValues("COMMUNICATION_ADMIN_USER_IDS");
  const codeHostMainBranch = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_MAIN_BRANCH",
  });
  const codeHostRepository = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_REPOSITORY",
  });
  const codeHostWebhookSecret = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_WEBHOOK_SECRET",
  });
  const codeHostToken = readOptionalEnvironmentValue("CODE_HOST_TOKEN");
  const configuredCodexUserLogins = readCommaSeparatedValues("CODE_HOST_CODEX_USER_LOGINS");
  const codeHostCodexUserLogins =
    configuredCodexUserLogins.length > 0
      ? configuredCodexUserLogins
      : [...DEFAULT_CODE_HOST_CODEX_USER_LOGINS];
  const codeHostOpenPrSyncIntervalHours = readPositiveInteger(
    "CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS",
    DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS,
  );
  const codexApprovalPollIntervalMinutes = readPositiveInteger(
    "CODEX_APPROVAL_POLL_INTERVAL_MINUTES",
    DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES,
  );
  const deployPollIntervalSeconds = readPositiveInteger(
    "DEPLOY_POLL_INTERVAL_SECONDS",
    10,
  );
  const deployTimeoutSeconds = readPositiveInteger(
    "DEPLOY_TIMEOUT_SECONDS",
    1200,
  );
  const deployToken = readOptionalEnvironmentValue("DEPLOY_TOKEN");
  const deployProductionAppId = readOptionalEnvironmentValue("DEPLOY_PROD_APP_ID");
  const deployRegion = readOptionalEnvironmentValue("DEPLOY_REGION") || DEFAULT_DEPLOY_REGION;
  const deployAccessKeyId = readOptionalEnvironmentValue("DEPLOY_ACCESS_KEY_ID");
  const deploySecretAccessKey = readOptionalEnvironmentValue("DEPLOY_SECRET_ACCESS_KEY");
  const deploySessionToken = readOptionalEnvironmentValue("DEPLOY_SESSION_TOKEN");
  const botName = readOptionalEnvironmentValue("BOT_NAME") || DEFAULT_BOT_NAME;

  return {
    botName,
    communicationProvider,
    codeHostProvider,
    deployProvider,
    databaseUrl: readRequiredEnvironmentVariable("DATABASE_URL"),
    deployPollIntervalSeconds,
    deployTimeoutSeconds,
    deployToken,
    deployProductionAppId,
    deployRegion,
    deployAccessKeyId,
    deploySecretAccessKey,
    deploySessionToken,
    codeHostOpenPrSyncIntervalHours,
    codexApprovalPollIntervalMinutes,
    codeHostApiBaseUrl: resolveCodeHostApiBaseUrl(codeHostProvider),
    codeHostApiVersion: DEFAULT_CODE_HOST_API_VERSION,
    codeHostApiPageSize: DEFAULT_CODE_HOST_API_PAGE_SIZE,
    codeHostApiMaxPages: DEFAULT_CODE_HOST_API_MAX_PAGES,
    codeHostApiUserAgent: DEFAULT_CODE_HOST_API_USER_AGENT,
    codeHostMainBranch,
    codeHostRepository,
    codeHostToken,
    codeHostCodexUserLogins,
    codeHostWebhookSecret,
    port: readPortNumber("PORT", 3000),
    communicationBotToken,
    communicationAppToken,
    communicationWebhookUrl,
    communicationCommandPath,
    communicationAdminUserIds,
  };
}

function buildRequiredEnvironmentVariables({ communicationProvider, codeHostProvider }) {
  const requiredEnvironmentVariables = ["DATABASE_URL"];

  if (communicationProvider === COMMUNICATION_PROVIDERS.slack) {
    requiredEnvironmentVariables.push(
      "COMMUNICATION_BOT_TOKEN",
      "COMMUNICATION_APP_TOKEN",
    );
  }

  if (
    codeHostProvider === CODE_HOST_PROVIDERS.github ||
    codeHostProvider === CODE_HOST_PROVIDERS.bitbucket
  ) {
    requiredEnvironmentVariables.push(
      "CODE_HOST_WEBHOOK_SECRET",
      "CODE_HOST_REPOSITORY",
      "CODE_HOST_MAIN_BRANCH",
    );
  }

  return requiredEnvironmentVariables;
}

function assertRequiredEnvironmentVariablesExist(requiredNames) {
  const missingEnvironmentVariables = requiredNames.filter(
    (name) => readOptionalEnvironmentValue(name) === "",
  );

  if (missingEnvironmentVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );
  }
}

function readRequiredEnvironmentVariable(name) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnvironmentValue(name) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

function readProviderSelection(name, fallback, supportedValues) {
  const rawValue = readOptionalEnvironmentValue(name);
  const selectedValue = rawValue === "" ? fallback : rawValue.toLowerCase();
  if (supportedValues.includes(selectedValue)) {
    return selectedValue;
  }

  throw new Error(
    `${name} must be one of: ${supportedValues.join(", ")}`,
  );
}

function readCommunicationValue({ communicationProvider, name }) {
  if (communicationProvider === COMMUNICATION_PROVIDERS.slack) {
    return readRequiredEnvironmentVariable(name);
  }

  return readOptionalEnvironmentValue(name);
}

function readCodeHostValue({ codeHostProvider, name }) {
  if (
    codeHostProvider === CODE_HOST_PROVIDERS.github ||
    codeHostProvider === CODE_HOST_PROVIDERS.bitbucket
  ) {
    return readRequiredEnvironmentVariable(name);
  }

  return readOptionalEnvironmentValue(name);
}

function readPortNumber(name, fallbackPort) {
  const value = readOptionalEnvironmentValue(name);
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
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readCommaSeparatedValues(name) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveCodeHostApiBaseUrl(codeHostProvider) {
  if (codeHostProvider === CODE_HOST_PROVIDERS.bitbucket) {
    return DEFAULT_BITBUCKET_API_BASE_URL;
  }

  return DEFAULT_GITHUB_API_BASE_URL;
}

module.exports = {
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEFAULT_CODE_HOST_PROVIDER,
  DEFAULT_COMMUNICATION_PROVIDER,
  DEFAULT_DEPLOY_PROVIDER,
  DEPLOY_PROVIDERS,
  DEFAULT_GITHUB_API_BASE_URL,
  DEFAULT_BITBUCKET_API_BASE_URL,
  DEFAULT_CODE_HOST_API_MAX_PAGES,
  DEFAULT_CODE_HOST_API_PAGE_SIZE,
  DEFAULT_CODE_HOST_API_USER_AGENT,
  DEFAULT_CODE_HOST_API_VERSION,
  DEFAULT_CODE_HOST_CODEX_USER_LOGINS,
  DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS,
  DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES,
  DEFAULT_COMMUNICATION_COMMAND_PATH,
  DEFAULT_BOT_NAME,
  resolveCodeHostApiBaseUrl,
  DEFAULT_DEPLOY_REGION,
  loadConfig,
};
