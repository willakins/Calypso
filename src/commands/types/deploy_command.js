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
          `Force deploy to prod is in progress (id: ${deploymentId}). Bypassed ${blockingPullRequestCount} blocking PR(s). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
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
          `Deploy to staging is in progress (id: ${deploymentId}).`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      return this.buildExecutionResult(
        `Deploy to prod is in progress (id: ${deploymentId}). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
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

module.exports = {
  DeployCommand,
};
