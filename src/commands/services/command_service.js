const {
  addUserToDeployWhitelist,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONE,
  getConfiguredTimeFormat,
  getConfiguredTimeZone,
  getLastProdDeployAt,
  getReviewRecapConfig,
  isUserWhitelistedForDeploy,
  insertDeployment,
  listOpenPullRequestsWaitingOnReviewSince,
  listRecentlyTestedPullRequests,
  listBlockingPullRequests,
  markReviewRecapSent,
  markAllUntestedPullRequestsTested,
  markPullRequestTested,
  markPullRequestsDeployedSince,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setConfiguredCommunicationProvider,
  setConfiguredCodeHostProvider,
  setConfiguredDeployProvider,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapSchedule,
  setReviewRecapTimeZone,
} = require("../../db");
const { DEFAULT_BOT_NAME } = require("../../config");
const { formatStatusResponse, isValidTimeZone } = require("../../util/format");
const { createCalypsoCommandRegistry } = require("../registry/command_registry");

function createCalypsoCommandService(serviceOptions = {}) {
  const commandRegistry = createCalypsoCommandRegistry({
    botName: serviceOptions.botName,
  });
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
    defaultBotName: DEFAULT_BOT_NAME,
    formatStatusResponseFn: formatStatusResponse,
    addUserToDeployWhitelistFn: addUserToDeployWhitelist,
    getLastProdDeployAtFn: getLastProdDeployAt,
    getConfiguredTimeFormatFn: getConfiguredTimeFormat,
    getConfiguredTimeZoneFn: getConfiguredTimeZone,
    isUserWhitelistedForDeployFn: isUserWhitelistedForDeploy,
    isValidTimeZoneFn: isValidTimeZone,
    isWorkspaceAdminFn: isWorkspaceAdmin,
    insertDeploymentFn: insertDeployment,
    getReviewRecapConfigFn: getReviewRecapConfig,
    listOpenPullRequestsWaitingOnReviewSinceFn: listOpenPullRequestsWaitingOnReviewSince,
    markReviewRecapSentFn: markReviewRecapSent,
    listRecentlyTestedPullRequestsFn: listRecentlyTestedPullRequests,
    listBlockingPullRequestsFn: listBlockingPullRequests,
    markAllUntestedPullRequestsTestedFn: markAllUntestedPullRequestsTested,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedSinceFn: markPullRequestsDeployedSince,
    readTimeFormatPreferenceFn: readTimeFormatPreference,
    readTimeZonePreferenceFn: readTimeZonePreference,
    resolveUserDisplayNameFn: resolveUserDisplayNameFromCommunicationClient,
    resolveDeployAccessFn: resolveDeployAccess,
    runOpenPullRequestSyncNowFn: null,
    setConfiguredTimeFormatFn: setConfiguredTimeFormat,
    setConfiguredTimeZoneFn: setConfiguredTimeZone,
    setConfiguredCommunicationProviderFn: setConfiguredCommunicationProvider,
    setConfiguredCodeHostProviderFn: setConfiguredCodeHostProvider,
    setConfiguredDeployProviderFn: setConfiguredDeployProvider,
    setReviewRecapChannelFn: setReviewRecapChannel,
    setReviewRecapRecencyFn: setReviewRecapRecency,
    setReviewRecapScheduleFn: setReviewRecapSchedule,
    setReviewRecapTimeZoneFn: setReviewRecapTimeZone,
    triggerProdDeployFn: triggerProductionDeploymentUnavailable,
    waitForProdDeployCompletionFn: waitForProductionDeploymentCompletionUnavailable,
  };
}

function buildRuntimeContext({ serviceOptions, commandContext, defaultDependencies }) {
  const mergedOptions = { ...serviceOptions, ...commandContext };
  const userId = mergedOptions.userId || mergedOptions.slackUserId;
  const communicationClient = mergedOptions.communicationClient || mergedOptions.slackClient || null;
  const currentChannelId = mergedOptions.currentChannelId || mergedOptions.channelId || null;
  const currentChannelName = mergedOptions.currentChannelName || mergedOptions.channelName || null;
  const deployPlatform = mergedOptions.deployPlatform || null;
  const deployConfig = {
    ...(serviceOptions.deployConfig || {}),
    ...(commandContext.deployConfig || {}),
  };
  if (commandContext.deployProvider) {
    deployConfig.deployProvider = commandContext.deployProvider;
  }

  return {
    botName: String(mergedOptions.botName || defaultDependencies.defaultBotName),
    addUserToDeployWhitelistFn:
      mergedOptions.addUserToDeployWhitelistFn || defaultDependencies.addUserToDeployWhitelistFn,
    deployConfig,
    formatStatusResponseFn:
      mergedOptions.formatStatusResponseFn || defaultDependencies.formatStatusResponseFn,
    getLastProdDeployAtFn:
      mergedOptions.getLastProdDeployAtFn || defaultDependencies.getLastProdDeployAtFn,
    getConfiguredTimeFormatFn:
      mergedOptions.getConfiguredTimeFormatFn || defaultDependencies.getConfiguredTimeFormatFn,
    getConfiguredTimeZoneFn:
      mergedOptions.getConfiguredTimeZoneFn || defaultDependencies.getConfiguredTimeZoneFn,
    getReviewRecapConfigFn:
      mergedOptions.getReviewRecapConfigFn || defaultDependencies.getReviewRecapConfigFn,
    isUserWhitelistedForDeployFn:
      mergedOptions.isUserWhitelistedForDeployFn || defaultDependencies.isUserWhitelistedForDeployFn,
    isValidTimeZoneFn: mergedOptions.isValidTimeZoneFn || defaultDependencies.isValidTimeZoneFn,
    isWorkspaceAdminFn: mergedOptions.isWorkspaceAdminFn || defaultDependencies.isWorkspaceAdminFn,
    insertDeploymentFn: mergedOptions.insertDeploymentFn || defaultDependencies.insertDeploymentFn,
    listRecentlyTestedPullRequestsFn:
      mergedOptions.listRecentlyTestedPullRequestsFn ||
      defaultDependencies.listRecentlyTestedPullRequestsFn,
    listOpenPullRequestsWaitingOnReviewSinceFn:
      mergedOptions.listOpenPullRequestsWaitingOnReviewSinceFn ||
      defaultDependencies.listOpenPullRequestsWaitingOnReviewSinceFn,
    listBlockingPullRequestsFn:
      mergedOptions.listBlockingPullRequestsFn || defaultDependencies.listBlockingPullRequestsFn,
    markAllUntestedPullRequestsTestedFn:
      mergedOptions.markAllUntestedPullRequestsTestedFn ||
      defaultDependencies.markAllUntestedPullRequestsTestedFn,
    markReviewRecapSentFn:
      mergedOptions.markReviewRecapSentFn || defaultDependencies.markReviewRecapSentFn,
    markPullRequestTestedFn:
      mergedOptions.markPullRequestTestedFn || defaultDependencies.markPullRequestTestedFn,
    markPullRequestsDeployedSinceFn:
      mergedOptions.markPullRequestsDeployedSinceFn ||
      defaultDependencies.markPullRequestsDeployedSinceFn,
    pool: mergedOptions.pool,
    readTimeFormatPreferenceFn:
      mergedOptions.readTimeFormatPreferenceFn || defaultDependencies.readTimeFormatPreferenceFn,
    readTimeZonePreferenceFn:
      mergedOptions.readTimeZonePreferenceFn || defaultDependencies.readTimeZonePreferenceFn,
    resolveUserDisplayNameFn:
      mergedOptions.resolveUserDisplayNameFn || defaultDependencies.resolveUserDisplayNameFn,
    resolveDeployAccessFn:
      mergedOptions.resolveDeployAccessFn || defaultDependencies.resolveDeployAccessFn,
    runOpenPullRequestSyncNowFn:
      mergedOptions.runOpenPullRequestSyncNowFn || defaultDependencies.runOpenPullRequestSyncNowFn,
    setConfiguredTimeFormatFn:
      mergedOptions.setConfiguredTimeFormatFn || defaultDependencies.setConfiguredTimeFormatFn,
    setConfiguredTimeZoneFn:
      mergedOptions.setConfiguredTimeZoneFn || defaultDependencies.setConfiguredTimeZoneFn,
    setConfiguredCommunicationProviderFn:
      mergedOptions.setConfiguredCommunicationProviderFn ||
      defaultDependencies.setConfiguredCommunicationProviderFn,
    setConfiguredCodeHostProviderFn:
      mergedOptions.setConfiguredCodeHostProviderFn ||
      defaultDependencies.setConfiguredCodeHostProviderFn,
    setConfiguredDeployProviderFn:
      mergedOptions.setConfiguredDeployProviderFn || defaultDependencies.setConfiguredDeployProviderFn,
    setReviewRecapChannelFn:
      mergedOptions.setReviewRecapChannelFn || defaultDependencies.setReviewRecapChannelFn,
    setReviewRecapRecencyFn:
      mergedOptions.setReviewRecapRecencyFn || defaultDependencies.setReviewRecapRecencyFn,
    setReviewRecapScheduleFn:
      mergedOptions.setReviewRecapScheduleFn || defaultDependencies.setReviewRecapScheduleFn,
    setReviewRecapTimeZoneFn:
      mergedOptions.setReviewRecapTimeZoneFn || defaultDependencies.setReviewRecapTimeZoneFn,
    communicationClient,
    currentChannelId,
    currentChannelName,
    userId,
    // Backward-compatible aliases while commands migrate to neutral naming.
    slackClient: communicationClient,
    slackUserId: userId,
    enableDeploymentCompletionNotifications: Boolean(
      mergedOptions.enableDeploymentCompletionNotifications,
    ),
    triggerProdDeployFn:
      mergedOptions.triggerProdDeployFn ||
      deriveDeployTriggerFunction(deployPlatform) ||
      defaultDependencies.triggerProdDeployFn,
    waitForProdDeployCompletionFn:
      mergedOptions.waitForProdDeployCompletionFn ||
      deriveDeployCompletionWaitFunction(deployPlatform) ||
      defaultDependencies.waitForProdDeployCompletionFn,
  };
}

function deriveDeployTriggerFunction(deployPlatform) {
  if (!deployPlatform || typeof deployPlatform.triggerProductionDeployment !== "function") {
    return null;
  }

  return deployPlatform.triggerProductionDeployment.bind(deployPlatform);
}

function deriveDeployCompletionWaitFunction(deployPlatform) {
  if (!deployPlatform || typeof deployPlatform.waitForProductionDeploymentCompletion !== "function") {
    return null;
  }

  return deployPlatform.waitForProductionDeploymentCompletion.bind(deployPlatform);
}

async function triggerProductionDeploymentUnavailable() {
  throw new Error("Deploy provider is not configured.");
}

async function waitForProductionDeploymentCompletionUnavailable() {
  throw new Error("Deploy provider is not configured.");
}

async function resolveDeployAccess(runtimeContext) {
  const callerUserId = runtimeContext.userId;
  if (!callerUserId) {
    return {
      canDeploy: false,
      reason: "missing user id",
    };
  }

  const callerIsWorkspaceAdmin = await runtimeContext.isWorkspaceAdminFn(
    runtimeContext.communicationClient,
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

async function readTimeFormatPreference(runtimeContext) {
  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return DEFAULT_TIME_FORMAT;
  }

  try {
    return await runtimeContext.getConfiguredTimeFormatFn(
      runtimeContext.pool,
      runtimeContext.userId,
    );
  } catch (_error) {
    return DEFAULT_TIME_FORMAT;
  }
}

async function readTimeZonePreference(runtimeContext) {
  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return DEFAULT_TIME_ZONE;
  }

  try {
    return await runtimeContext.getConfiguredTimeZoneFn(
      runtimeContext.pool,
      runtimeContext.userId,
    );
  } catch (_error) {
    return DEFAULT_TIME_ZONE;
  }
}

async function resolveUserDisplayNameFromCommunicationClient(communicationClient, userId) {
  if (!communicationClient || !userId || !communicationClient.users || !communicationClient.users.info) {
    return null;
  }

  try {
    const response = await communicationClient.users.info({ user: userId });
    const user = response.user || {};
    const profile = user.profile || {};
    return profile.display_name || profile.real_name || user.name || null;
  } catch (_error) {
    return null;
  }
}

async function isWorkspaceAdmin(communicationClient, userId) {
  if (!communicationClient || !userId || !communicationClient.users || !communicationClient.users.info) {
    return false;
  }

  try {
    const response = await communicationClient.users.info({ user: userId });
    const user = response.user || {};
    return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  createCalypsoCommandService,
};
