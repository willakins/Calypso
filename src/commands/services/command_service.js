const {
  addUserToDeployWhitelist,
  clearSupportEmailOnCall,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONE,
  getErrorTrackingConfig,
  getEnvironmentStatusConfig,
  getConfiguredTimeFormat,
  getConfiguredTimeZone,
  getLastProdDeployAt,
  getReviewRecapConfig,
  getSupportEmailConfig,
  isUserWhitelistedForDeploy,
  insertDeployment,
  listPendingSupportEmailThreads,
  listOpenErrorTrackingIssues,
  listOpenPullRequestsWaitingOnReviewSince,
  listRecentlyTestedPullRequests,
  listBlockingPullRequests,
  markEnvironmentStatusNotificationSent,
  markReviewRecapSent,
  markAllUntestedPullRequestsTested,
  markPullRequestTested,
  markPullRequestsDeployedSince,
  markSupportEmailThreadNotificationSent,
  markSupportEmailThreadResponded,
  recordEnvironmentStatusObservation,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setConfiguredCommunicationProvider,
  setConfiguredCodeHostProvider,
  setConfiguredDeployProvider,
  setErrorTrackingChannel,
  setErrorTrackingEnabled,
  setErrorTrackingEnvironment,
  setErrorTrackingProject,
  setEnvironmentStatusChannel,
  setEnvironmentStatusEnabled,
  setEnvironmentStatusUrl,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapSchedule,
  setReviewRecapSendHolidays,
  setReviewRecapSendWeekends,
  setReviewRecapTimeZone,
  setSupportEmailChannel,
  setSupportEmailMonitorEnabled,
  setSupportEmailOnCall,
  updateSupportEmailRuntimeState,
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
    getErrorTrackingConfigFn: getErrorTrackingConfig,
    formatStatusResponseFn: formatStatusResponse,
    addUserToDeployWhitelistFn: addUserToDeployWhitelist,
    clearSupportEmailOnCallFn: clearSupportEmailOnCall,
    getEnvironmentStatusConfigFn: getEnvironmentStatusConfig,
    getLastProdDeployAtFn: getLastProdDeployAt,
    getConfiguredTimeFormatFn: getConfiguredTimeFormat,
    getConfiguredTimeZoneFn: getConfiguredTimeZone,
    isUserWhitelistedForDeployFn: isUserWhitelistedForDeploy,
    isValidTimeZoneFn: isValidTimeZone,
    isWorkspaceAdminFn: isWorkspaceAdmin,
    insertDeploymentFn: insertDeployment,
    getReviewRecapConfigFn: getReviewRecapConfig,
    getSupportEmailConfigFn: getSupportEmailConfig,
    listPendingSupportEmailThreadsFn: listPendingSupportEmailThreads,
    listOpenErrorTrackingIssuesFn: listOpenErrorTrackingIssues,
    listOpenPullRequestsWaitingOnReviewSinceFn: listOpenPullRequestsWaitingOnReviewSince,
    markReviewRecapSentFn: markReviewRecapSent,
    listRecentlyTestedPullRequestsFn: listRecentlyTestedPullRequests,
    listBlockingPullRequestsFn: listBlockingPullRequests,
    markAllUntestedPullRequestsTestedFn: markAllUntestedPullRequestsTested,
    markEnvironmentStatusNotificationSentFn: markEnvironmentStatusNotificationSent,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedSinceFn: markPullRequestsDeployedSince,
    markSupportEmailThreadNotificationSentFn: markSupportEmailThreadNotificationSent,
    markSupportEmailThreadRespondedFn: markSupportEmailThreadResponded,
    recordEnvironmentStatusObservationFn: recordEnvironmentStatusObservation,
    readTimeFormatPreferenceFn: readTimeFormatPreference,
    readTimeZonePreferenceFn: readTimeZonePreference,
    resolveUserDisplayNameFn: resolveUserDisplayNameFromCommunicationClient,
    resolveCurrentChannelTopicFn: resolveCurrentChannelTopicFromCommunicationClient,
    resolveDeployAccessFn: resolveDeployAccess,
    runOpenPullRequestSyncNowFn: null,
    setConfiguredTimeFormatFn: setConfiguredTimeFormat,
    setConfiguredTimeZoneFn: setConfiguredTimeZone,
    setConfiguredCommunicationProviderFn: setConfiguredCommunicationProvider,
    setConfiguredCodeHostProviderFn: setConfiguredCodeHostProvider,
    setConfiguredDeployProviderFn: setConfiguredDeployProvider,
    setErrorTrackingChannelFn: setErrorTrackingChannel,
    setErrorTrackingEnabledFn: setErrorTrackingEnabled,
    setErrorTrackingEnvironmentFn: setErrorTrackingEnvironment,
    setErrorTrackingProjectFn: setErrorTrackingProject,
    setEnvironmentStatusChannelFn: setEnvironmentStatusChannel,
    setEnvironmentStatusEnabledFn: setEnvironmentStatusEnabled,
    setEnvironmentStatusUrlFn: setEnvironmentStatusUrl,
    setReviewRecapChannelFn: setReviewRecapChannel,
    setReviewRecapRecencyFn: setReviewRecapRecency,
    setReviewRecapScheduleFn: setReviewRecapSchedule,
    setReviewRecapSendWeekendsFn: setReviewRecapSendWeekends,
    setReviewRecapSendHolidaysFn: setReviewRecapSendHolidays,
    setReviewRecapTimeZoneFn: setReviewRecapTimeZone,
    setSupportEmailChannelFn: setSupportEmailChannel,
    setSupportEmailMonitorEnabledFn: setSupportEmailMonitorEnabled,
    setSupportEmailOnCallFn: setSupportEmailOnCall,
    triggerProdDeployFn: triggerProductionDeploymentUnavailable,
    updateSupportEmailRuntimeStateFn: updateSupportEmailRuntimeState,
    waitForProdDeployCompletionFn: waitForProductionDeploymentCompletionUnavailable,
  };
}

function buildRuntimeContext({ serviceOptions, commandContext, defaultDependencies }) {
  const mergedOptions = { ...serviceOptions, ...commandContext };
  const userId = mergedOptions.userId || mergedOptions.slackUserId;
  const callerUserName = mergedOptions.callerUserName || mergedOptions.userName || null;
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
    errorTrackingProvider:
      mergedOptions.errorTrackingProvider || serviceOptions.errorTrackingProvider || "sentry",
    addUserToDeployWhitelistFn:
      mergedOptions.addUserToDeployWhitelistFn || defaultDependencies.addUserToDeployWhitelistFn,
    clearSupportEmailOnCallFn:
      mergedOptions.clearSupportEmailOnCallFn || defaultDependencies.clearSupportEmailOnCallFn,
    deployConfig,
    formatStatusResponseFn:
      mergedOptions.formatStatusResponseFn || defaultDependencies.formatStatusResponseFn,
    getErrorTrackingConfigFn:
      mergedOptions.getErrorTrackingConfigFn || defaultDependencies.getErrorTrackingConfigFn,
    getEnvironmentStatusConfigFn:
      mergedOptions.getEnvironmentStatusConfigFn || defaultDependencies.getEnvironmentStatusConfigFn,
    getLastProdDeployAtFn:
      mergedOptions.getLastProdDeployAtFn || defaultDependencies.getLastProdDeployAtFn,
    getConfiguredTimeFormatFn:
      mergedOptions.getConfiguredTimeFormatFn || defaultDependencies.getConfiguredTimeFormatFn,
    getConfiguredTimeZoneFn:
      mergedOptions.getConfiguredTimeZoneFn || defaultDependencies.getConfiguredTimeZoneFn,
    getReviewRecapConfigFn:
      mergedOptions.getReviewRecapConfigFn || defaultDependencies.getReviewRecapConfigFn,
    getSupportEmailConfigFn:
      mergedOptions.getSupportEmailConfigFn || defaultDependencies.getSupportEmailConfigFn,
    isUserWhitelistedForDeployFn:
      mergedOptions.isUserWhitelistedForDeployFn || defaultDependencies.isUserWhitelistedForDeployFn,
    isValidTimeZoneFn: mergedOptions.isValidTimeZoneFn || defaultDependencies.isValidTimeZoneFn,
    isWorkspaceAdminFn: mergedOptions.isWorkspaceAdminFn || defaultDependencies.isWorkspaceAdminFn,
    insertDeploymentFn: mergedOptions.insertDeploymentFn || defaultDependencies.insertDeploymentFn,
    listPendingSupportEmailThreadsFn:
      mergedOptions.listPendingSupportEmailThreadsFn ||
      defaultDependencies.listPendingSupportEmailThreadsFn,
    listOpenErrorTrackingIssuesFn:
      mergedOptions.listOpenErrorTrackingIssuesFn ||
      defaultDependencies.listOpenErrorTrackingIssuesFn,
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
    markEnvironmentStatusNotificationSentFn:
      mergedOptions.markEnvironmentStatusNotificationSentFn ||
      defaultDependencies.markEnvironmentStatusNotificationSentFn,
    markReviewRecapSentFn:
      mergedOptions.markReviewRecapSentFn || defaultDependencies.markReviewRecapSentFn,
    markPullRequestTestedFn:
      mergedOptions.markPullRequestTestedFn || defaultDependencies.markPullRequestTestedFn,
    markPullRequestsDeployedSinceFn:
      mergedOptions.markPullRequestsDeployedSinceFn ||
      defaultDependencies.markPullRequestsDeployedSinceFn,
    markSupportEmailThreadNotificationSentFn:
      mergedOptions.markSupportEmailThreadNotificationSentFn ||
      defaultDependencies.markSupportEmailThreadNotificationSentFn,
    markSupportEmailThreadRespondedFn:
      mergedOptions.markSupportEmailThreadRespondedFn ||
      defaultDependencies.markSupportEmailThreadRespondedFn,
    pool: mergedOptions.pool,
    recordEnvironmentStatusObservationFn:
      mergedOptions.recordEnvironmentStatusObservationFn ||
      defaultDependencies.recordEnvironmentStatusObservationFn,
    readTimeFormatPreferenceFn:
      mergedOptions.readTimeFormatPreferenceFn || defaultDependencies.readTimeFormatPreferenceFn,
    readTimeZonePreferenceFn:
      mergedOptions.readTimeZonePreferenceFn || defaultDependencies.readTimeZonePreferenceFn,
    resolveUserDisplayNameFn:
      mergedOptions.resolveUserDisplayNameFn || defaultDependencies.resolveUserDisplayNameFn,
    resolveCurrentChannelTopicFn:
      mergedOptions.resolveCurrentChannelTopicFn ||
      defaultDependencies.resolveCurrentChannelTopicFn,
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
    setErrorTrackingChannelFn:
      mergedOptions.setErrorTrackingChannelFn || defaultDependencies.setErrorTrackingChannelFn,
    setErrorTrackingEnabledFn:
      mergedOptions.setErrorTrackingEnabledFn || defaultDependencies.setErrorTrackingEnabledFn,
    setErrorTrackingEnvironmentFn:
      mergedOptions.setErrorTrackingEnvironmentFn ||
      defaultDependencies.setErrorTrackingEnvironmentFn,
    setErrorTrackingProjectFn:
      mergedOptions.setErrorTrackingProjectFn || defaultDependencies.setErrorTrackingProjectFn,
    setEnvironmentStatusChannelFn:
      mergedOptions.setEnvironmentStatusChannelFn || defaultDependencies.setEnvironmentStatusChannelFn,
    setEnvironmentStatusEnabledFn:
      mergedOptions.setEnvironmentStatusEnabledFn || defaultDependencies.setEnvironmentStatusEnabledFn,
    setEnvironmentStatusUrlFn:
      mergedOptions.setEnvironmentStatusUrlFn || defaultDependencies.setEnvironmentStatusUrlFn,
    setReviewRecapChannelFn:
      mergedOptions.setReviewRecapChannelFn || defaultDependencies.setReviewRecapChannelFn,
    setReviewRecapRecencyFn:
      mergedOptions.setReviewRecapRecencyFn || defaultDependencies.setReviewRecapRecencyFn,
    setReviewRecapScheduleFn:
      mergedOptions.setReviewRecapScheduleFn || defaultDependencies.setReviewRecapScheduleFn,
    setReviewRecapSendWeekendsFn:
      mergedOptions.setReviewRecapSendWeekendsFn ||
      defaultDependencies.setReviewRecapSendWeekendsFn,
    setReviewRecapSendHolidaysFn:
      mergedOptions.setReviewRecapSendHolidaysFn ||
      defaultDependencies.setReviewRecapSendHolidaysFn,
    setReviewRecapTimeZoneFn:
      mergedOptions.setReviewRecapTimeZoneFn || defaultDependencies.setReviewRecapTimeZoneFn,
    setSupportEmailChannelFn:
      mergedOptions.setSupportEmailChannelFn || defaultDependencies.setSupportEmailChannelFn,
    setSupportEmailMonitorEnabledFn:
      mergedOptions.setSupportEmailMonitorEnabledFn ||
      defaultDependencies.setSupportEmailMonitorEnabledFn,
    setSupportEmailOnCallFn:
      mergedOptions.setSupportEmailOnCallFn || defaultDependencies.setSupportEmailOnCallFn,
    communicationClient,
    currentChannelId,
    currentChannelName,
    userId,
    callerUserName,
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
    updateSupportEmailRuntimeStateFn:
      mergedOptions.updateSupportEmailRuntimeStateFn ||
      defaultDependencies.updateSupportEmailRuntimeStateFn,
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

async function resolveCurrentChannelTopicFromCommunicationClient(runtimeContext) {
  const channelId = String(runtimeContext.currentChannelId || "").trim();
  const conversationsApi = runtimeContext.communicationClient?.conversations;
  if (channelId === "" || !conversationsApi || typeof conversationsApi.info !== "function") {
    return null;
  }

  try {
    const response = await conversationsApi.info({ channel: channelId });
    const topic = response?.channel?.topic?.value;
    return typeof topic === "string" ? topic : null;
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
