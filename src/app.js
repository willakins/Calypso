const { App } = require("@slack/bolt");
const express = require("express");

const { registerCalypsoCommand } = require("./commands/calypso");
const { loadConfig } = require("./config");
const { createPool, runMigrations, verifyConnection } = require("./db");
const { registerGithubWebhook } = require("./integrations/github/webhook");

async function start() {
  const runtime = await loadRuntime();

  wireHealthcheckRoute(runtime);
  wireSlackCommands(runtime);
  wireGithubWebhook(runtime);

  await startServices(runtime);

  console.log("Calypso is running in Socket Mode with database migrations applied.");
}

async function loadRuntime() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const slackApp = createSlackApp(config);
  const httpApp = express();

  await initializeDatabase(pool);

  return {
    config,
    httpApp,
    pool,
    slackApp,
  };
}

function createSlackApp(config) {
  return new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });
}

async function initializeDatabase(pool) {
  await verifyConnection(pool);
  await runMigrations(pool);
}

function wireSlackCommands(runtime) {
  registerCalypsoCommand(runtime.slackApp, {
    pool: runtime.pool,
    deployConfig: buildDeployConfig(runtime.config),
  });
}

function wireHealthcheckRoute(runtime) {
  runtime.httpApp.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
  });
}

function buildDeployConfig(config) {
  return {
    digitaloceanToken: config.digitaloceanToken,
    doAppIdProd: config.doAppIdProd,
  };
}

function wireGithubWebhook(runtime) {
  registerGithubWebhook(runtime.httpApp, {
    pool: runtime.pool,
    github: buildGithubConfig(runtime.config),
  });
}

function buildGithubConfig(config) {
  return {
    mainBranch: config.githubMainBranch,
    repositoryFullName: config.githubRepo,
    webhookSecret: config.githubWebhookSecret,
  };
}

async function startServices(runtime) {
  await startHttpServer(runtime.httpApp, runtime.config.port);
  await runtime.slackApp.start();
}

function startHttpServer(httpApp, port) {
  return new Promise((resolve) => {
    httpApp.listen(port, () => {
      console.log(`GitHub webhook server listening on port ${port}.`);
      resolve();
    });
  });
}

start().catch((error) => {
  console.error("Failed to start Calypso.");
  console.error(error.message);
  process.exit(1);
});
