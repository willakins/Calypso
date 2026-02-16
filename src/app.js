const express = require("express");

const { loadConfig } = require("./config");
const { createPool, runMigrations, verifyConnection } = require("./db");
const {
  runOpenPullRequestSyncTick,
  startOpenPullRequestSyncScheduler,
} = require("./background_jobs/scheduler");
const { createCodeHostPlatform } = require("./platform/code_host/factory");
const { createCommunicationPlatform } = require("./platform/communication/factory");
const { createDeployPlatform } = require("./platform/deploy/factory");
const { startReviewRecapScheduler } = require("./background_jobs/review_recap_scheduler");

async function start() {
  const runtime = await loadRuntime();

  wireHealthcheckRoute(runtime);
  wireCommunicationCommands(runtime);
  wireCodeHostWebhook(runtime);

  await startServices(runtime);
  startBackgroundSchedulers(runtime);

  console.log("Calypso is running in Socket Mode with database migrations applied.");
}

async function loadRuntime() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const httpApp = express();
  const communicationPlatform = createCommunicationPlatform({
    provider: config.communicationProvider,
    config,
  });
  const codeHostPlatform = createCodeHostPlatform({
    provider: config.codeHostProvider,
    config,
  });
  const deployPlatform = createDeployPlatform({
    provider: config.deployProvider,
    config,
  });
  const codeHostSyncClient = codeHostPlatform.createSyncClient();

  await initializeDatabase(pool);

  return {
    config,
    communicationPlatform,
    codeHostPlatform,
    codeHostSyncClient,
    deployPlatform,
    httpApp,
    pool,
  };
}

async function initializeDatabase(pool) {
  await verifyConnection(pool);
  await runMigrations(pool);
}

function wireCommunicationCommands(runtime) {
  runtime.communicationPlatform.registerCalypsoCommand({
    enableDeploymentCompletionNotifications: true,
    pool: runtime.pool,
    deployPlatform: runtime.deployPlatform,
    isWorkspaceAdminFn: async (_communicationClient, userId) =>
      runtime.communicationPlatform.isWorkspaceAdmin(userId),
    deployConfig: buildDeployConfig(runtime.config),
    resolveUserDisplayNameFn: async (_communicationClient, userId) =>
      runtime.communicationPlatform.resolveUserDisplayName(userId),
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
    deployProvider: config.deployProvider,
    deploymentPollIntervalMs: config.deployPollIntervalSeconds * 1000,
    deploymentTimeoutMs: config.deployTimeoutSeconds * 1000,
    deployToken: config.deployToken,
    deployProductionAppId: config.deployProductionAppId,
  };
}

function wireCodeHostWebhook(runtime) {
  runtime.codeHostPlatform.registerWebhookRoutes(runtime.httpApp, {
    pool: runtime.pool,
  });
}

async function startServices(runtime) {
  await startHttpServer(runtime.httpApp, runtime.config.port, {
    codeHostProvider: runtime.config.codeHostProvider,
  });
  await runtime.communicationPlatform.start();
}

function startBackgroundSchedulers(runtime) {
  runtime.reviewRecapScheduler = startReviewRecapScheduler({
    communicationClient: runtime.communicationPlatform,
    pool: runtime.pool,
  });

  runtime.openPullRequestSyncScheduler = startOpenPullRequestSyncScheduler({
    codeHostClient: runtime.codeHostSyncClient,
    mainBranch: runtime.config.codeHostMainBranch,
    pool: runtime.pool,
    repository: runtime.config.codeHostRepository,
    syncIntervalMs: runtime.config.codeHostOpenPrSyncIntervalHours * 60 * 60 * 1000,
  });
}

function buildRunOpenPullRequestSyncNow(runtime) {
  if (!runtime.codeHostSyncClient) {
    return null;
  }

  return () =>
    runOpenPullRequestSyncTick({
      codeHostClient: runtime.codeHostSyncClient,
      logger: console,
      mainBranch: runtime.config.codeHostMainBranch,
      pool: runtime.pool,
      repository: runtime.config.codeHostRepository,
      swallowErrors: false,
    });
}

function startHttpServer(httpApp, port, options = {}) {
  const providerLabel = formatProviderLabel(options.codeHostProvider || "code-host");
  return new Promise((resolve) => {
    httpApp.listen(port, () => {
      console.log(`${providerLabel} webhook server listening on port ${port}.`);
      resolve();
    });
  });
}

function formatProviderLabel(providerName) {
  const normalizedProviderName = String(providerName || "").trim().toLowerCase();
  if (normalizedProviderName === "") {
    return "Code-host";
  }

  return normalizedProviderName
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

start().catch((error) => {
  console.error("Failed to start Calypso.");
  console.error(error.message);
  process.exit(1);
});
