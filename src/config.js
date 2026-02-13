const dotenv = require("dotenv");

dotenv.config();

function loadConfig() {
  const required = [
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "DATABASE_URL",
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_REPO",
    "GITHUB_MAIN_BRANCH",
  ];
  const missing = required.filter((key) => !process.env[key] || process.env[key].trim() === "");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    databaseUrl: process.env.DATABASE_URL,
    digitaloceanToken: process.env.DIGITALOCEAN_TOKEN || "",
    doAppIdProd: process.env.DO_APP_ID_PROD || "",
    githubMainBranch: process.env.GITHUB_MAIN_BRANCH,
    githubRepo: process.env.GITHUB_REPO,
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    port: Number(process.env.PORT || 3000),
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
  };
}

module.exports = {
  loadConfig,
};
