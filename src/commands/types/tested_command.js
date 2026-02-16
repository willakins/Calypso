const { BaseCalypsoCommand } = require("./base_command");
const { TIMEFRAME_DEFINITIONS, isValidTimeframe, timeframeSince } = require("../../shared/timeframes");
const { formatPullRequestReference, formatTimestampByTimeFormat } = require("../../util/format");

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
      if (!isValidTimeframe(secondArgument)) {
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

  async checkCallerAccess({ parsedCommand, runtime }) {
    const requiresElevatedAccess =
      parsedCommand.action === "tested_single" || parsedCommand.action === "tested_all";
    if (!requiresElevatedAccess) {
      return this.allowAccess();
    }

    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Tested update denied.",
          "Only workspace admins or whitelisted users can mark PRs as tested.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Tested command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "tested_all") {
      const markedCount = await runtime.markAllUntestedPullRequestsTestedFn(
        runtime.pool,
        runtime.userId,
      );

      if (markedCount === 0) {
        return this.buildExecutionResult("No untested PRs found.");
      }

      return this.buildExecutionResult(`Marked ${markedCount} untested PR(s) as tested.`);
    }

    if (parsedCommand.action === "tested_recent") {
      const timeframeDefinition = TIMEFRAME_DEFINITIONS[parsedCommand.timeframe];
      const sinceTimestamp = timeframeSince(parsedCommand.timeframe, Date.now());
      const recentlyTestedPullRequests = await runtime.listRecentlyTestedPullRequestsFn(
        runtime.pool,
        sinceTimestamp,
      );
      const timeFormat = await runtime.readTimeFormatPreferenceFn(runtime);
      const timeZone = await runtime.readTimeZonePreferenceFn(runtime);
      const testedByNameById = await resolveTestedByNames(recentlyTestedPullRequests, runtime);

      if (recentlyTestedPullRequests.length === 0) {
        return this.buildExecutionResult(
          `No PRs tested in the last ${timeframeDefinition.displayName}.`,
        );
      }

      return this.buildExecutionResult(
        [
          `PRs tested in the last ${timeframeDefinition.displayName}:`,
          ...recentlyTestedPullRequests.map((pullRequest) =>
            formatRecentlyTestedPullRequestLine(pullRequest, testedByNameById, timeFormat, timeZone),
          ),
        ].join("\n"),
      );
    }

    const testedResult = await runtime.markPullRequestTestedFn(
      runtime.pool,
      parsedCommand.prNumber,
      runtime.userId,
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

async function resolveTestedByNames(recentlyTestedPullRequests, runtime) {
  const testedByUserIds = [...new Set(
    recentlyTestedPullRequests
      .map((pullRequest) => pullRequest.tested_by)
      .filter(Boolean),
  )];
  const testedByNameById = new Map();
  const resolveUserDisplayNameFn = runtime.resolveUserDisplayNameFn;

  for (const userId of testedByUserIds) {
    const testedByName =
      typeof resolveUserDisplayNameFn === "function"
        ? await resolveUserDisplayNameFn(runtime.communicationClient, userId)
        : null;
    if (testedByName) {
      testedByNameById.set(userId, testedByName);
    }
  }

  return testedByNameById;
}

function formatRecentlyTestedPullRequestLine(
  pullRequest,
  testedByNameById,
  timeFormat,
  timeZone,
) {
  const pullRequestReference = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
  });
  const testedByUserId = pullRequest.tested_by || null;
  const testedBy =
    (testedByUserId && testedByNameById.get(testedByUserId)) || testedByUserId || "unknown user";
  const testedAt = pullRequest.tested_at
    ? formatTimestampByTimeFormat(pullRequest.tested_at, { timeFormat, timeZone })
    : "at an unknown time";
  const titleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return `• ${pullRequestReference}${titleSuffix} (${pullRequest.status}) tested by ${testedBy} ${testedAt}`;
}

module.exports = {
  TestedCommand,
};
