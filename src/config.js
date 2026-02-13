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

function loadConfig() {
  assertRequiredEnvironmentVariablesExist(REQUIRED_ENVIRONMENT_VARIABLES);

  return {
    databaseUrl: readRequiredEnvironmentVariable("DATABASE_URL"),
    digitaloceanToken: readOptionalEnvironmentVariable("DIGITALOCEAN_TOKEN"),
    doAppIdProd: readOptionalEnvironmentVariable("DO_APP_ID_PROD"),
    githubMainBranch: readRequiredEnvironmentVariable("GITHUB_MAIN_BRANCH"),
    githubRepo: readRequiredEnvironmentVariable("GITHUB_REPO"),
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

module.exports = {
  loadConfig,
};
