const { App } = require("@slack/bolt");
const express = require("express");

const { registerCalypsoCommand } = require("./commands/calypso");
const { loadConfig } = require("./config");
const { createPool, runMigrations, verifyConnection } = require("./db");
const { registerGithubWebhook } = require("./integrations/github/webhook");

async function start() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  await verifyConnection(pool);
  await runMigrations(pool);

  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });
  const httpApp = express();

  registerGithubWebhook(httpApp, { pool, config });
  registerCalypsoCommand(app, {
    pool,
    deployConfig: {
      digitaloceanToken: config.digitaloceanToken,
      doAppIdProd: config.doAppIdProd,
    },
  });

  await new Promise((resolve) => {
    httpApp.listen(config.port, () => {
      console.log(`GitHub webhook server listening on port ${config.port}.`);
      resolve();
    });
  });

  await app.start();
  console.log("Calypso is running in Socket Mode with database migrations applied.");
}

start().catch((error) => {
  console.error("Failed to start Calypso.");
  console.error(error.message);
  process.exit(1);
});
