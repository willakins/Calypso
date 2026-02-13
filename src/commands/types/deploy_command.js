const { BaseCalypsoCommand } = require("./base_calypso_command");

class DeployCommand extends BaseCalypsoCommand {
  constructor() {
    super("deploy");
  }

  parse({ commandWords }) {
    const hasEnvironmentArgument = commandWords.length === 2;
    const environmentName = (commandWords[1] || "").toLowerCase();
    const isProductionDeploy = hasEnvironmentArgument && environmentName === "prod";

    if (!isProductionDeploy) {
      return this.buildRespondParsedCommand("Usage: `/calypso deploy prod`");
    }

    return this.buildParsedCommand({
      action: "deploy_prod",
    });
  }

  async execute({ runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Deploy command unavailable: database pool is not configured.");
    }

    const deployGateState = await this.readDeployGateState(runtime);
    if (deployGateState.blockingPullRequests.length > 0) {
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
      return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.");
    }

    const deployResult = await runtime.triggerProdDeployFn(runtime.deployConfig);
    const deploymentSummary = await this.recordDeploymentAndMarkPullRequests({
      runtime,
      lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
      externalDeploymentId: deployResult.externalDeployId,
    });

    const deploymentId = deploymentSummary.externalDeploymentId || "n/a";
    return this.buildExecutionResult(
      `Deploy triggered (id: ${deploymentId}). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
    );
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
    return Boolean(deployConfig.digitaloceanToken) && Boolean(deployConfig.doAppIdProd);
  }

  async recordDeploymentAndMarkPullRequests({
    runtime,
    lastProductionDeploymentAt,
    externalDeploymentId,
  }) {
    return this.withDatabaseTransaction(runtime.pool, async () => {
      const deploymentRecord = await runtime.insertDeploymentFn(runtime.pool, {
        environment: "prod",
        provider: "digitalocean",
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
      }
      throw error;
    }
  }
}

module.exports = {
  DeployCommand,
};
