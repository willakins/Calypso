const { BaseCalypsoCommand } = require("./base_command");
const { formatPullRequestReference } = require("../../util/format");

class DeployCommand extends BaseCalypsoCommand {
  constructor() {
    super("deploy");
  }

  parse({ commandWords }) {
    const hasEnvironmentArgument = commandWords.length === 2 || commandWords.length === 3;
    const environmentName = (commandWords[1] || "").toLowerCase();
    const forceWord = (commandWords[2] || "").toLowerCase();
    const isForceDeployWord = forceWord === "force" || forceWord === "forced";
    const hasValidForceArgument = commandWords.length === 2 || isForceDeployWord;
    const hasValidEnvironmentName = environmentName === "prod" || environmentName === "staging";
    const isValidDeployCommand =
      hasEnvironmentArgument && hasValidForceArgument && hasValidEnvironmentName;

    if (!isValidDeployCommand) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso deploy staging`",
          "`/calypso deploy prod`",
          "`/calypso deploy prod force`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: environmentName === "staging" ? "deploy_staging" : "deploy_prod",
      deployEnvironment: environmentName,
      forceDeployment: isForceDeployWord,
    });
  }

  async checkCallerAccess({ runtime }) {
    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Deploy denied.",
          "Only workspace admins or whitelisted users can deploy.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Deploy command unavailable: database pool is not configured.");
    }

    const deployEnvironment = this.resolveDeployEnvironment(parsedCommand);
    const isProductionDeploy = deployEnvironment === "prod";
    const forceDeployment = Boolean(parsedCommand.forceDeployment);
    const channelTopicGuardDecision = await this.evaluateChannelTopicGuard({
      runtime,
      deployEnvironment,
    });
    if (!channelTopicGuardDecision.isAllowed) {
      return this.buildExecutionResult(channelTopicGuardDecision.reasonText);
    }
    let deployGateState = {
      blockingPullRequests: [],
      lastProductionDeploymentAt: null,
    };
    let blockingPullRequestCount = 0;

    if (isProductionDeploy) {
      deployGateState = await this.readDeployGateState(runtime);
      blockingPullRequestCount = deployGateState.blockingPullRequests.length;

      if (blockingPullRequestCount > 0 && !forceDeployment) {
        return this.buildExecutionResult(
          [
            "Deploy blocked due to untested PRs:",
            ...deployGateState.blockingPullRequests.map(
              (pr) =>
                `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
            ),
          ].join("\n"),
        );
      }
    }

    const deployConfiguration = this.resolveDeployConfiguration(
      runtime.deployConfig,
      deployEnvironment,
    );
    if (!this.hasDeployConfiguration(deployConfiguration)) {
      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy bypassed ${blockingPullRequestCount} blocking PR(s), but deploy not configured.`,
        );
      }

      if (isProductionDeploy) {
        return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.");
      }

      return this.buildExecutionResult("Deploy to staging is not configured.");
    }

    try {
      const deployResult = await runtime.triggerProdDeployFn(deployConfiguration);
      const deploymentTriggeredBy = await this.resolveDeploymentTriggeredBy(runtime);
      const deployProvider =
        deployResult.deployProvider || deployConfiguration.deployProvider || "digitalocean";
      let deploymentSummary = {
        deployedPullRequestCount: 0,
        externalDeploymentId: deployResult.externalDeployId,
      };

      if (isProductionDeploy) {
        deploymentSummary = await this.recordDeploymentAndMarkPullRequests({
          runtime,
          lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
          externalDeploymentId: deployResult.externalDeployId,
          provider: deployProvider,
        });
      }

      const deploymentId = deploymentSummary.externalDeploymentId || "n/a";
      const shouldNotifyDeploymentCompletion =
        runtime.enableDeploymentCompletionNotifications &&
        Boolean(deploymentSummary.externalDeploymentId);
      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}. Bypassed ${blockingPullRequestCount} blocking PR(s). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      if (!isProductionDeploy) {
        return this.buildExecutionResult(
          `Deploy to staging is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      return this.buildExecutionResult(
        `Deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}. Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
        this.buildDeploymentExecutionFields({
          externalDeploymentId: deploymentSummary.externalDeploymentId,
          deployProvider,
          shouldNotifyDeploymentCompletion,
          deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
        }),
      );
    } catch (error) {
      if (this.didDeploymentTransactionRollback(error)) {
        return this.buildExecutionResult(
          "Deploy failed while recording deployment state. Transaction was rolled back; no deploy records or PR statuses were committed.",
        );
      }

      return this.buildExecutionResult(
        `Deploy failed before deployment state was committed: ${error.message}`,
      );
    }
  }

  async readDeployGateState(runtime) {
    const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );

    return {
      blockingPullRequests,
      lastProductionDeploymentAt,
    };
  }

  hasDeployConfiguration(deployConfig) {
    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    const deployAppId = deployConfig.deployProductionAppId;
    const hasDigitalOceanConfig = Boolean(deployToken) && Boolean(deployAppId);
    const hasAwsConfig = Boolean(
      deployAppId &&
        deployConfig.deployRegion &&
        deployConfig.deployAccessKeyId &&
        deployConfig.deploySecretAccessKey,
    );

    return hasDigitalOceanConfig || hasAwsConfig;
  }

  resolveDeployEnvironment(parsedCommand) {
    const rawEnvironment = String(parsedCommand.deployEnvironment || "prod").trim().toLowerCase();
    if (rawEnvironment === "staging") {
      return "staging";
    }
    return "prod";
  }

  async evaluateChannelTopicGuard({ runtime, deployEnvironment }) {
    const resolveCurrentChannelTopicFn = runtime.resolveCurrentChannelTopicFn;
    if (typeof resolveCurrentChannelTopicFn !== "function") {
      return { isAllowed: true };
    }

    const channelTopic = await resolveCurrentChannelTopicFn(runtime);
    if (typeof channelTopic !== "string" || channelTopic.trim() === "") {
      return { isAllowed: true };
    }

    const topicStatus = readDeployAvailabilityFromTopic(channelTopic, deployEnvironment);
    if (topicStatus !== "blocked") {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      reasonText: [
        `Cannot deploy to ${deployEnvironment} from this channel right now.`,
        "Channel topic indicates deploy is not allowed for that environment (red status).",
      ].join(" "),
    };
  }

  resolveDeployConfiguration(deployConfig = {}, deployEnvironment = "prod") {
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;
    const deployStagingAppId = deployConfig.deployStagingAppId || deployConfig.doAppIdStaging;
    const selectedAppId =
      deployEnvironment === "staging" ? deployStagingAppId || "" : deployProductionAppId || "";

    return {
      ...deployConfig,
      deployTargetEnvironment: deployEnvironment,
      deployProductionAppId: selectedAppId,
    };
  }

  buildDeployConfigOverridesForCompletion(deployConfiguration) {
    return {
      deployTargetEnvironment: deployConfiguration.deployTargetEnvironment,
      deployProductionAppId: deployConfiguration.deployProductionAppId,
    };
  }

  async resolveDeploymentTriggeredBy(runtime) {
    const callerUserName = String(runtime.callerUserName || "").trim();
    if (callerUserName !== "") {
      return callerUserName;
    }

    const callerUserId = String(runtime.userId || "").trim();
    const resolveUserDisplayNameFn = runtime.resolveUserDisplayNameFn;
    if (callerUserId !== "" && typeof resolveUserDisplayNameFn === "function") {
      try {
        const displayName = await resolveUserDisplayNameFn(
          runtime.communicationClient,
          callerUserId,
        );
        const normalizedDisplayName = String(displayName || "").trim();
        if (normalizedDisplayName !== "") {
          return normalizedDisplayName;
        }
      } catch (_error) {
        // Ignore lookup failures and fall back to user id.
      }
    }

    if (callerUserId !== "") {
      return callerUserId;
    }

    return "unknown user";
  }

  async recordDeploymentAndMarkPullRequests({
    runtime,
    lastProductionDeploymentAt,
    externalDeploymentId,
    provider,
  }) {
    return this.withDatabaseTransaction(runtime.pool, async () => {
      const deploymentRecord = await runtime.insertDeploymentFn(runtime.pool, {
        environment: "prod",
        provider: provider || runtime.deployConfig.deployProvider || "digitalocean",
        externalDeployId: externalDeploymentId,
      });

      const deployedPullRequestCount = await runtime.markPullRequestsDeployedSinceFn(
        runtime.pool,
        lastProductionDeploymentAt,
        deploymentRecord.deployed_at,
      );

      return {
        deployedPullRequestCount,
        externalDeploymentId,
      };
    });
  }

  async withDatabaseTransaction(pool, transactionalWork) {
    let transactionStarted = false;

    try {
      await pool.query("BEGIN");
      transactionStarted = true;

      const result = await transactionalWork();

      await pool.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        await pool.query("ROLLBACK");
        throw this.buildRolledBackDeploymentError(error);
      }
      throw error;
    }
  }

  buildRolledBackDeploymentError(cause) {
    const rolledBackError = new Error("Deployment state transaction rolled back.", { cause });
    rolledBackError.code = "DEPLOY_STATE_ROLLED_BACK";
    return rolledBackError;
  }

  didDeploymentTransactionRollback(error) {
    return Boolean(error) && error.code === "DEPLOY_STATE_ROLLED_BACK";
  }

  resolveResponseType({ executionResult }) {
    return executionResult.deployTriggered ? "in_channel" : "ephemeral";
  }

  resolveFollowUpResponseType({ executionResult, responseType }) {
    if (executionResult.deployTriggered) {
      return "in_channel";
    }

    return responseType;
  }

  buildDeploymentExecutionFields({
    externalDeploymentId,
    deployProvider,
    shouldNotifyDeploymentCompletion,
    deployConfigOverrides,
  }) {
    return {
      deployTriggered: true,
      externalDeploymentId,
      deployProvider: deployProvider || null,
      deployConfigOverrides: deployConfigOverrides || {},
      shouldNotifyDeploymentCompletion,
    };
  }
}

function readDeployAvailabilityFromTopic(topicText, deployEnvironment) {
  const rawTopic = String(topicText || "");
  const segment = readEnvironmentTopicSegment(rawTopic, deployEnvironment);
  if (!segment) {
    return "unknown";
  }

  const normalizedSegment = segment.toLowerCase();
  const hasRedStatus = [":red_circle:", ":large_red_circle:", "🔴"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasRedStatus) {
    return "blocked";
  }

  const hasGreenStatus = [":green_circle:", ":large_green_circle:", "🟢"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasGreenStatus) {
    return "allowed";
  }

  return "unknown";
}

function readEnvironmentTopicSegment(topicText, deployEnvironment) {
  const normalizedEnvironment = String(deployEnvironment || "").toLowerCase();
  const targetLabel =
    normalizedEnvironment === "prod" ? "(?:prod|production)" : "(?:staging)";
  const otherLabel =
    normalizedEnvironment === "prod" ? "(?:staging)" : "(?:prod|production)";
  const pattern = new RegExp(
    `\\b${targetLabel}\\b\\s*:\\s*(.*?)(?=\\b${otherLabel}\\b\\s*:|$)`,
    "i",
  );
  const match = String(topicText || "").match(pattern);
  return match?.[1] ? String(match[1]).trim() : "";
}

module.exports = {
  DeployCommand,
};
