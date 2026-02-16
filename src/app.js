const { App } = require("@slack/bolt");
const express = require("express");

const { registerCalypsoCommand } = require("./commands/calypso");
const { loadConfig } = require("./config");
const { createPool, runMigrations, verifyConnection } = require("./db");
const { createGithubClient } = require("./integrations/github/client");
const { registerGithubWebhook } = require("./integrations/github/webhook");
const {
  runOpenPullRequestSyncTick,
  startOpenPullRequestSyncScheduler,
} = require("./open_pr_sync/scheduler");
const { startReviewRecapScheduler } = require("./review_recap/scheduler");

async function start() {
  const runtime = await loadRuntime();

  wireHealthcheckRoute(runtime);
  wireSlackCommands(runtime);
  wireGithubWebhook(runtime);

  await startServices(runtime);
  startBackgroundSchedulers(runtime);

  console.log("Calypso is running in Socket Mode with database migrations applied.");
}

async function loadRuntime() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const slackApp = createSlackApp(config);
  const httpApp = express();
  const githubSyncClient = buildGithubSyncClient(config);

  await initializeDatabase(pool);

  return {
    config,
    githubSyncClient,
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
    enableDeploymentCompletionNotifications: true,
    pool: runtime.pool,
    deployConfig: buildDeployConfig(runtime.config),
    runOpenPullRequestSyncNowFn: buildRunOpenPullRequestSyncNow(runtime),
  });
}

function wireHealthcheckRoute(runtime) {
  runtime.httpApp.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
  });
}

function buildDeployConfig(config) {
  return {
    doDeploymentPollIntervalMs: config.doDeployPollIntervalSeconds * 1000,
    doDeploymentTimeoutMs: config.doDeployTimeoutSeconds * 1000,
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

function startBackgroundSchedulers(runtime) {
  runtime.reviewRecapScheduler = startReviewRecapScheduler({
    pool: runtime.pool,
    slackClient: runtime.slackApp.client,
  });

  runtime.openPullRequestSyncScheduler = startOpenPullRequestSyncScheduler({
    githubClient: runtime.githubSyncClient,
    mainBranch: runtime.config.githubMainBranch,
    pool: runtime.pool,
    repositoryFullName: runtime.config.githubRepo,
    syncIntervalMs: runtime.config.githubOpenPrSyncIntervalHours * 60 * 60 * 1000,
  });
}

function buildGithubSyncClient(config) {
  if (!config.githubToken) {
    return null;
  }

  return createGithubClient({
    apiBaseUrl: config.githubApiBaseUrl,
    apiMaxPages: config.githubApiMaxPages,
    apiPageSize: config.githubApiPageSize,
    apiUserAgent: config.githubApiUserAgent,
    apiVersion: config.githubApiVersion,
    token: config.githubToken,
  });
}

function buildRunOpenPullRequestSyncNow(runtime) {
  if (!runtime.githubSyncClient) {
    return null;
  }

  return () =>
    runOpenPullRequestSyncTick({
      githubClient: runtime.githubSyncClient,
      logger: console,
      mainBranch: runtime.config.githubMainBranch,
      pool: runtime.pool,
      repositoryFullName: runtime.config.githubRepo,
      swallowErrors: false,
    });
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
