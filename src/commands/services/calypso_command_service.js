const {
  getLastProdDeployAt,
  insertDeployment,
  listBlockingPullRequests,
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
  };
}

function createDefaultDependencies() {
  return {
    formatStatusResponseFn: formatStatusResponse,
    getLastProdDeployAtFn: getLastProdDeployAt,
    insertDeploymentFn: insertDeployment,
    listBlockingPullRequestsFn: listBlockingPullRequests,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedSinceFn: markPullRequestsDeployedSince,
    triggerProdDeployFn: triggerProductionDeployment,
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
    listBlockingPullRequestsFn:
      mergedOptions.listBlockingPullRequestsFn || defaultDependencies.listBlockingPullRequestsFn,
    markPullRequestTestedFn:
      mergedOptions.markPullRequestTestedFn || defaultDependencies.markPullRequestTestedFn,
    markPullRequestsDeployedSinceFn:
      mergedOptions.markPullRequestsDeployedSinceFn ||
      defaultDependencies.markPullRequestsDeployedSinceFn,
    pool: mergedOptions.pool,
    slackUserId: mergedOptions.slackUserId,
    triggerProdDeployFn: mergedOptions.triggerProdDeployFn || defaultDependencies.triggerProdDeployFn,
  };
}

async function triggerProductionDeployment(deployConfig) {
  const digitalOceanClient = createDigitalOceanClient({ token: deployConfig.digitaloceanToken });
  return digitalOceanClient.triggerAppDeployment(deployConfig.doAppIdProd);
}

module.exports = {
  createCalypsoCommandService,
};
