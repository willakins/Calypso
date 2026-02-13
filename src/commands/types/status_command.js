const { BaseCalypsoCommand } = require("./base_calypso_command");

class StatusCommand extends BaseCalypsoCommand {
  constructor() {
    super("status");
  }

  parse() {
    return this.buildParsedCommand({
      action: "status",
    });
  }

  async execute({ runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Status unavailable: database pool is not configured.");
    }

    const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );

    const responseText = runtime.formatStatusResponseFn({
      lastDeployAt: lastProductionDeploymentAt,
      blockers: blockingPullRequests,
    });

    return this.buildExecutionResult(responseText);
  }
}

module.exports = {
  StatusCommand,
};
