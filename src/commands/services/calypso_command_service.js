const {
  addUserToDeployWhitelist,
  getLastProdDeployAt,
  isUserWhitelistedForDeploy,
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

    async resolveDeployAccess(commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return runtimeContext.resolveDeployAccessFn(runtimeContext);
    },
  };
}

function createDefaultDependencies() {
  return {
    formatStatusResponseFn: formatStatusResponse,
    addUserToDeployWhitelistFn: addUserToDeployWhitelist,
    getLastProdDeployAtFn: getLastProdDeployAt,
    isUserWhitelistedForDeployFn: isUserWhitelistedForDeploy,
    isWorkspaceAdminFn: isWorkspaceAdmin,
    insertDeploymentFn: insertDeployment,
    listRecentlyTestedPullRequestsFn: listRecentlyTestedPullRequests,
    listBlockingPullRequestsFn: listBlockingPullRequests,
    markAllUntestedPullRequestsTestedFn: markAllUntestedPullRequestsTested,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedSinceFn: markPullRequestsDeployedSince,
    resolveDeployAccessFn: resolveDeployAccess,
    triggerProdDeployFn: triggerProductionDeployment,
    waitForProdDeployCompletionFn: waitForProductionDeploymentCompletion,
  };
}

function buildRuntimeContext({ serviceOptions, commandContext, defaultDependencies }) {
  const mergedOptions = { ...serviceOptions, ...commandContext };

  return {
    addUserToDeployWhitelistFn:
      mergedOptions.addUserToDeployWhitelistFn || defaultDependencies.addUserToDeployWhitelistFn,
    deployConfig: mergedOptions.deployConfig || {},
    formatStatusResponseFn:
      mergedOptions.formatStatusResponseFn || defaultDependencies.formatStatusResponseFn,
    getLastProdDeployAtFn:
      mergedOptions.getLastProdDeployAtFn || defaultDependencies.getLastProdDeployAtFn,
    isUserWhitelistedForDeployFn:
      mergedOptions.isUserWhitelistedForDeployFn || defaultDependencies.isUserWhitelistedForDeployFn,
    isWorkspaceAdminFn: mergedOptions.isWorkspaceAdminFn || defaultDependencies.isWorkspaceAdminFn,
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
    resolveDeployAccessFn:
      mergedOptions.resolveDeployAccessFn || defaultDependencies.resolveDeployAccessFn,
    slackClient: mergedOptions.slackClient || null,
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

async function resolveDeployAccess(runtimeContext) {
  const callerUserId = runtimeContext.slackUserId;
  if (!callerUserId) {
    return {
      canDeploy: false,
      reason: "missing user id",
    };
  }

  const callerIsWorkspaceAdmin = await runtimeContext.isWorkspaceAdminFn(
    runtimeContext.slackClient,
    callerUserId,
  );
  if (callerIsWorkspaceAdmin) {
    return {
      canDeploy: true,
      source: "workspace_admin",
    };
  }

  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return {
      canDeploy: false,
      reason: "whitelist lookup unavailable",
    };
  }

  const callerIsWhitelisted = await runtimeContext.isUserWhitelistedForDeployFn(
    runtimeContext.pool,
    callerUserId,
  );
  if (callerIsWhitelisted) {
    return {
      canDeploy: true,
      source: "deploy_whitelist",
    };
  }

  return {
    canDeploy: false,
    reason: "not authorized",
  };
}

async function isWorkspaceAdmin(slackClient, slackUserId) {
  if (!slackClient || !slackUserId) {
    return false;
  }

  try {
    const response = await slackClient.users.info({ user: slackUserId });
    const user = response.user || {};
    return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  createCalypsoCommandService,
};
