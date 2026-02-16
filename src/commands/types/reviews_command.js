const { BaseCalypsoCommand } = require("./base_calypso_command");
const { isValidTimeframe, timeframeSince } = require("../../shared/timeframes");
const { formatTimestampByTimeFormat } = require("../../util/format");

class ReviewsCommand extends BaseCalypsoCommand {
  constructor() {
    super("reviews");
  }

  parse({ commandWords }) {
    const argumentsList = commandWords.slice(1);
    if (argumentsList.length > 3) {
      return this.buildRespondParsedCommand(buildUsageMessage());
    }

    let sawRecentKeyword = false;
    let timeframe = null;
    let githubUser = null;

    for (const argument of argumentsList) {
      const normalizedArgument = String(argument || "").trim();
      const lowerCasedArgument = normalizedArgument.toLowerCase();

      if (lowerCasedArgument === "recent") {
        sawRecentKeyword = true;
        continue;
      }

      if (isValidTimeframe(lowerCasedArgument)) {
        if (timeframe) {
          return this.buildRespondParsedCommand(buildUsageMessage());
        }
        timeframe = lowerCasedArgument;
        continue;
      }

      const normalizedGithubUser = normalizeGithubUser(normalizedArgument);
      if (!normalizedGithubUser || githubUser) {
        return this.buildRespondParsedCommand(buildUsageMessage());
      }
      githubUser = normalizedGithubUser;
    }

    if (sawRecentKeyword && !timeframe) {
      return this.buildRespondParsedCommand(buildUsageMessage());
    }

    return this.buildParsedCommand({
      action: "reviews_list",
      githubUser,
      timeframe,
    });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Reviews command unavailable: database pool is not configured.");
    }

    const sinceTimestamp = parsedCommand.timeframe
      ? timeframeSince(parsedCommand.timeframe, Date.now())
      : new Date(0);
    const waitingPullRequests = await runtime.listOpenPullRequestsWaitingOnReviewSinceFn(
      runtime.pool,
      sinceTimestamp,
    );
    const filteredPullRequests = parsedCommand.githubUser
      ? waitingPullRequests.filter(
        (pullRequest) =>
          String(pullRequest.author_login || "").toLowerCase() === parsedCommand.githubUser,
      )
      : waitingPullRequests;

    if (filteredPullRequests.length === 0) {
      return this.buildExecutionResult(
        buildNoResultsMessage({
          githubUser: parsedCommand.githubUser,
          timeframe: parsedCommand.timeframe,
        }),
      );
    }

    const timeFormat = await runtime.readTimeFormatPreferenceFn(runtime);
    const timeZone = await runtime.readTimeZonePreferenceFn(runtime);
    return this.buildExecutionResult(
      [
        buildResultsHeader({
          githubUser: parsedCommand.githubUser,
          timeframe: parsedCommand.timeframe,
        }),
        ...filteredPullRequests.map((pullRequest) =>
          formatWaitingPullRequestLine({ pullRequest, timeFormat, timeZone }),
        ),
      ].join("\n"),
    );
  }
}

function normalizeGithubUser(rawGithubUser) {
  const trimmedGithubUser = String(rawGithubUser || "").trim();
  const withoutAtSign = trimmedGithubUser.replace(/^@/, "");
  if (withoutAtSign === "") {
    return null;
  }

  return /^[a-zA-Z0-9-]+$/.test(withoutAtSign) ? withoutAtSign.toLowerCase() : null;
}

function buildUsageMessage() {
  return [
    "Usage:",
    "`/calypso reviews`",
    "`/calypso reviews <GITHUB_USER>`",
    "`/calypso reviews <day|week|month>`",
    "`/calypso reviews recent <day|week|month>`",
    "`/calypso reviews <GITHUB_USER> <day|week|month>`",
  ].join("\n");
}

function buildResultsHeader({ githubUser, timeframe }) {
  const timeScopeSuffix = timeframe ? ` in the last ${timeframe}` : "";
  const githubUserSuffix = githubUser ? ` for github user ${githubUser}` : "";
  return `Open PRs waiting on review${timeScopeSuffix}${githubUserSuffix}:`;
}

function buildNoResultsMessage({ githubUser, timeframe }) {
  const timeScopeSuffix = timeframe ? ` in the last ${timeframe}` : "";
  const githubUserSuffix = githubUser ? ` for github user ${githubUser}` : "";
  return `No open PRs waiting on review${timeScopeSuffix}${githubUserSuffix}.`;
}

function formatWaitingPullRequestLine({ pullRequest, timeFormat, timeZone }) {
  const titleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  const authorLogin = pullRequest.author_login || "unknown";
  const openedForReviewAt = pullRequest.opened_for_review_at
    ? formatTimestampByTimeFormat(pullRequest.opened_for_review_at, { timeFormat, timeZone })
    : "at an unknown time";
  return `• ${pullRequest.repo}#${pullRequest.pr_number}${titleSuffix} | created by ${authorLogin} | opened for review ${openedForReviewAt}`;
}

module.exports = {
  ReviewsCommand,
};
