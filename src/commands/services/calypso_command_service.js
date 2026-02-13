const {
  getLastProdDeployAt,
  insertDeployment,
  listRecentlyTestedPullRequests,
  listBlockingPullRequests,
  markAllUntestedPullRequestsTested,
  markPullRequestTested,
  markPullRequestsDeployedSince,
} = require("../../db");
const { createDigitalOceanClient } = require("../../integrations/digitalocean/client");
const { formatStatusResponse } = require("../../util/format");
const { createCalypsoCommandRegistry } = require("../registry/calypso_command_registry");

function createCalypsoCommandService(serviceOptions = {}) {
  const commandRegistry = createCalypsoCommandRegistry();
  const defaultDependencies = createDefaultDependencies();

  return {
    async execute(parsedCommand, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return commandRegistry.execute(parsedCommand, runtimeContext);
    },

    async waitForProdDeploymentCompletion(externalDeployId, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return runtimeContext.waitForProdDeployCompletionFn(
        runtimeContext.deployConfig,
        externalDeployId,
      );
    },
  };
}

function createDefaultDependencies() {
  return {
    formatStatusResponseFn: formatStatusResponse,
    getLastProdDeployAtFn: getLastProdDeployAt,
    insertDeploymentFn: insertDeployment,
    listRecentlyTestedPullRequestsFn: listRecentlyTestedPullRequests,
    listBlockingPullRequestsFn: listBlockingPullRequests,
    markAllUntestedPullRequestsTestedFn: markAllUntestedPullRequestsTested,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedSinceFn: markPullRequestsDeployedSince,
    triggerProdDeployFn: triggerProductionDeployment,
    waitForProdDeployCompletionFn: waitForProductionDeploymentCompletion,
  };
}

function buildRuntimeContext({ serviceOptions, commandContext, defaultDependencies }) {
  const mergedOptions = { ...serviceOptions, ...commandContext };

  return {
    deployConfig: mergedOptions.deployConfig || {},
    formatStatusResponseFn:
      mergedOptions.formatStatusResponseFn || defaultDependencies.formatStatusResponseFn,
    getLastProdDeployAtFn:
      mergedOptions.getLastProdDeployAtFn || defaultDependencies.getLastProdDeployAtFn,
    insertDeploymentFn: mergedOptions.insertDeploymentFn || defaultDependencies.insertDeploymentFn,
    listRecentlyTestedPullRequestsFn:
      mergedOptions.listRecentlyTestedPullRequestsFn ||
      defaultDependencies.listRecentlyTestedPullRequestsFn,
    listBlockingPullRequestsFn:
      mergedOptions.listBlockingPullRequestsFn || defaultDependencies.listBlockingPullRequestsFn,
    markAllUntestedPullRequestsTestedFn:
      mergedOptions.markAllUntestedPullRequestsTestedFn ||
      defaultDependencies.markAllUntestedPullRequestsTestedFn,
    markPullRequestTestedFn:
      mergedOptions.markPullRequestTestedFn || defaultDependencies.markPullRequestTestedFn,
    markPullRequestsDeployedSinceFn:
      mergedOptions.markPullRequestsDeployedSinceFn ||
      defaultDependencies.markPullRequestsDeployedSinceFn,
    pool: mergedOptions.pool,
    slackUserId: mergedOptions.slackUserId,
    enableDeploymentCompletionNotifications: Boolean(
      mergedOptions.enableDeploymentCompletionNotifications,
    ),
    triggerProdDeployFn: mergedOptions.triggerProdDeployFn || defaultDependencies.triggerProdDeployFn,
    waitForProdDeployCompletionFn:
      mergedOptions.waitForProdDeployCompletionFn || defaultDependencies.waitForProdDeployCompletionFn,
  };
}

async function triggerProductionDeployment(deployConfig) {
  const digitalOceanClient = createDigitalOceanClient({ token: deployConfig.digitaloceanToken });
  return digitalOceanClient.triggerAppDeployment(deployConfig.doAppIdProd);
}

async function waitForProductionDeploymentCompletion(deployConfig, externalDeployId) {
  const digitalOceanClient = createDigitalOceanClient({ token: deployConfig.digitaloceanToken });
  return digitalOceanClient.waitForAppDeploymentCompletion(
    deployConfig.doAppIdProd,
    externalDeployId,
    {
      pollIntervalMs: deployConfig.doDeploymentPollIntervalMs,
      timeoutMs: deployConfig.doDeploymentTimeoutMs,
    },
  );
}

module.exports = {
  createCalypsoCommandService,
};
