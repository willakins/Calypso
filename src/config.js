const dotenv = require("dotenv");

dotenv.config();

function loadConfig() {
  const required = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"];
  const missing = required.filter((key) => !process.env[key] || process.env[key].trim() === "");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
  };
}

module.exports = {
  loadConfig,
};
