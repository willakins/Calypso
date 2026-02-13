const { BaseCalypsoCommand } = require("./base_calypso_command");

class TestedCommand extends BaseCalypsoCommand {
  constructor() {
    super("tested");
  }

  parse({ commandWords }) {
    const hasExactlyOneArgument = commandWords.length === 2;
    const prNumber = Number(commandWords[1]);
    const hasValidPrNumber = Number.isInteger(prNumber) && prNumber > 0;

    if (!hasExactlyOneArgument || !hasValidPrNumber) {
      return this.buildRespondParsedCommand("Usage: `/calypso tested <PR_NUMBER>`");
    }

    return this.buildParsedCommand({
      action: "tested",
      prNumber,
    });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Tested command unavailable: database pool is not configured.");
    }

    const testedResult = await runtime.markPullRequestTestedFn(
      runtime.pool,
      parsedCommand.prNumber,
      runtime.slackUserId,
    );

    if (!testedResult.found) {
      return this.buildExecutionResult(`PR #${parsedCommand.prNumber} not found.`);
    }

    if (testedResult.alreadyTested) {
      return this.buildExecutionResult(`PR #${parsedCommand.prNumber} is already marked tested.`);
    }

    return this.buildExecutionResult(`Marked PR #${parsedCommand.prNumber} as tested.`);
  }
}

module.exports = {
  TestedCommand,
};
