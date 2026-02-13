const { BaseCalypsoCommand } = require("./base_calypso_command");

const TIMEFRAME_DEFINITIONS = {
  day: {
    displayName: "day",
    windowMs: 24 * 60 * 60 * 1000,
  },
  week: {
    displayName: "week",
    windowMs: 7 * 24 * 60 * 60 * 1000,
  },
  month: {
    displayName: "month",
    windowMs: 30 * 24 * 60 * 60 * 1000,
  },
};

class TestedCommand extends BaseCalypsoCommand {
  constructor() {
    super("tested");
  }

  parse({ commandWords }) {
    const firstArgument = (commandWords[1] || "").toLowerCase();
    const secondArgument = (commandWords[2] || "").toLowerCase();

    if (commandWords.length === 2 && firstArgument === "all") {
      return this.buildParsedCommand({
        action: "tested_all",
      });
    }

    if (commandWords.length === 3 && firstArgument === "recent") {
      if (!TIMEFRAME_DEFINITIONS[secondArgument]) {
        return this.buildRespondParsedCommand(
          "Usage: `/calypso tested recent <day|week|month>`",
        );
      }

      return this.buildParsedCommand({
        action: "tested_recent",
        timeframe: secondArgument,
      });
    }

    const prNumber = Number(commandWords[1]);
    const hasExactlyOneArgument = commandWords.length === 2;
    const hasValidPrNumber = Number.isInteger(prNumber) && prNumber > 0;
    if (!hasExactlyOneArgument || !hasValidPrNumber) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso tested <PR_NUMBER>`",
          "`/calypso tested all`",
          "`/calypso tested recent <day|week|month>`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: "tested_single",
      prNumber,
    });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Tested command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "tested_all") {
      const markedCount = await runtime.markAllUntestedPullRequestsTestedFn(
        runtime.pool,
        runtime.slackUserId,
      );

      if (markedCount === 0) {
        return this.buildExecutionResult("No untested PRs found.");
      }

      return this.buildExecutionResult(`Marked ${markedCount} untested PR(s) as tested.`);
    }

    if (parsedCommand.action === "tested_recent") {
      const timeframeDefinition = TIMEFRAME_DEFINITIONS[parsedCommand.timeframe];
      const sinceTimestamp = new Date(Date.now() - timeframeDefinition.windowMs);
      const recentlyTestedPullRequests = await runtime.listRecentlyTestedPullRequestsFn(
        runtime.pool,
        sinceTimestamp,
      );

      if (recentlyTestedPullRequests.length === 0) {
        return this.buildExecutionResult(
          `No PRs tested in the last ${timeframeDefinition.displayName}.`,
        );
      }

      return this.buildExecutionResult(
        [
          `PRs tested in the last ${timeframeDefinition.displayName}:`,
          ...recentlyTestedPullRequests.map(formatRecentlyTestedPullRequestLine),
        ].join("\n"),
      );
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

function formatRecentlyTestedPullRequestLine(pullRequest) {
  const testedBy = pullRequest.tested_by || "unknown user";
  const testedAt = pullRequest.tested_at
    ? new Date(pullRequest.tested_at).toISOString()
    : "unknown time";
  const titleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return `• ${pullRequest.repo}#${pullRequest.pr_number}${titleSuffix} (${pullRequest.status}) tested by ${testedBy} at ${testedAt}`;
}

module.exports = {
  TestedCommand,
};
