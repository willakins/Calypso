const { BaseCalypsoCommand } = require("./base_calypso_command");

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
    const isProductionDeploy =
      hasEnvironmentArgument && hasValidForceArgument && environmentName === "prod";

    if (!isProductionDeploy) {
      return this.buildRespondParsedCommand(
        "Usage: `/calypso deploy prod` or `/calypso deploy prod force`",
      );
    }

    return this.buildParsedCommand({
      action: "deploy_prod",
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

    const deployGateState = await this.readDeployGateState(runtime);
    const blockingPullRequestCount = deployGateState.blockingPullRequests.length;
    const forceDeployment = Boolean(parsedCommand.forceDeployment);

    if (blockingPullRequestCount > 0 && !forceDeployment) {
      return this.buildExecutionResult(
        [
          "Deploy blocked due to untested PRs:",
          ...deployGateState.blockingPullRequests.map(
            (pr) => `• ${pr.repo}#${pr.pr_number} (${pr.status})`,
          ),
        ].join("\n"),
      );
    }

    if (!this.hasDeployConfiguration(runtime.deployConfig)) {
      if (forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy bypassed ${blockingPullRequestCount} blocking PR(s), but deploy not configured.`,
        );
      }
      return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.");
    }

    try {
      const deployResult = await runtime.triggerProdDeployFn(runtime.deployConfig);
      const deploymentSummary = await this.recordDeploymentAndMarkPullRequests({
        runtime,
        lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
        externalDeploymentId: deployResult.externalDeployId,
      });

      const deploymentId = deploymentSummary.externalDeploymentId || "n/a";
      const shouldNotifyDeploymentCompletion =
        runtime.enableDeploymentCompletionNotifications &&
        Boolean(deploymentSummary.externalDeploymentId);
      if (forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy to prod is in progress (id: ${deploymentId}). Bypassed ${blockingPullRequestCount} blocking PR(s). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            shouldNotifyDeploymentCompletion,
          }),
        );
      }

      return this.buildExecutionResult(
        `Deploy to prod is in progress (id: ${deploymentId}). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
        this.buildDeploymentExecutionFields({
          externalDeploymentId: deploymentSummary.externalDeploymentId,
          shouldNotifyDeploymentCompletion,
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
    const deployProvider = String(deployConfig.deployProvider || "digitalocean").toLowerCase();
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;

    if (deployProvider === "aws") {
      return Boolean(
        deployProductionAppId &&
          deployConfig.deployRegion &&
          deployConfig.deployAccessKeyId &&
          deployConfig.deploySecretAccessKey,
      );
    }

    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    return Boolean(deployToken) && Boolean(deployProductionAppId);
  }

  async recordDeploymentAndMarkPullRequests({
    runtime,
    lastProductionDeploymentAt,
    externalDeploymentId,
  }) {
    return this.withDatabaseTransaction(runtime.pool, async () => {
      const deploymentRecord = await runtime.insertDeploymentFn(runtime.pool, {
        environment: "prod",
        provider: runtime.deployConfig.deployProvider || "digitalocean",
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
    shouldNotifyDeploymentCompletion,
  }) {
    return {
      deployTriggered: true,
      externalDeploymentId,
      shouldNotifyDeploymentCompletion,
    };
  }
}

module.exports = {
  DeployCommand,
};
