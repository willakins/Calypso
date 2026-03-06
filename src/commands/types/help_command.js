const { BaseCalypsoCommand } = require("./base_command");
const { DEFAULT_BOT_NAME } = require("../../config");

class HelpCommand extends BaseCalypsoCommand {
  constructor(options = {}) {
    super("help");
    this.botName = String(options.botName || DEFAULT_BOT_NAME);
  }

  parse({ commandWords }) {
    const topic = normalizeHelpTopic(commandWords[1]);
    if (commandWords.length > 2 || topic === null) {
      return this.buildRespondParsedCommand(buildHelpTopicUsageMessage());
    }

    return this.buildRespondParsedCommand(buildHelpText(this.botName, topic));
  }
}

function buildHelpText(botName, topic) {
  if (topic === "testing") {
    return buildTestingHelpText(botName);
  }

  if (topic === "reviewing") {
    return buildReviewingHelpText(botName);
  }

  if (topic === "config") {
    return buildConfigHelpText(botName);
  }

  return buildOverviewHelpText(botName);
}

function buildOverviewHelpText(botName) {
  return [
    `*${botName}*`,
    "Slack deployment gatekeeper.",
    "",
    "*Quick Start*",
    "`/calypso help` Show this message.",
    "`/calypso sync` Run PR sync now (review state + merged untested).",
    "`/calypso status` Show deploy blockers since last prod deploy.",
    "`/calypso errors` Show unresolved tracked errors.",
    "`/calypso emails` Show pending customer support emails.",
    "`/calypso deploy staging` Trigger staging deploy.",
    "`/calypso deploy prod` Attempt prod deploy after gate check.",
    "",
    "*Help Topics*",
    "`/calypso help testing` PR testing and deploy-gate commands.",
    "`/calypso help reviewing` Review queues and recap commands.",
    "`/calypso help config` Runtime config and recap schedule setup.",
  ].join("\n");
}

function buildTestingHelpText(botName) {
  return [
    `*${botName} Testing Help*`,
    "",
    "`/calypso tested <PR_NUMBER>` Mark one PR as tested.",
    "`/calypso tested all` Mark all untested PRs as tested.",
    "`/calypso tested recent <day|week|month>` List recently tested PRs.",
    "`/calypso status` Show blockers since last prod deploy.",
    "`/calypso deploy staging` Trigger staging deploy.",
    "`/calypso deploy prod` Attempt prod deploy after gate check.",
    "`/calypso deploy prod force` Force deploy and bypass blockers.",
    "`/calypso whitelist <@USER>` Allow deploy/test updates for a user.",
  ].join("\n");
}

function buildReviewingHelpText(botName) {
  return [
    `*${botName} Reviewing Help*`,
    "",
    "`/calypso reviews` List open PRs waiting on review.",
    "`/calypso reviews <GITHUB_USER>` Filter by PR author.",
    "`/calypso reviews <day|week|month>` Filter by recency window.",
    "`/calypso reviews recent <day|week|month>` Explicit recent-window form.",
    "`/calypso sync` Run immediate sync with code host.",
    "`/calypso errors` List unresolved tracked errors.",
    "`/calypso emails` List pending customer support emails.",
    "",
    "*Review Recap*",
    "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config review-recap-recency:<Nd|Nw>`",
    "`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/calypso config review-recap-send-weekends:<on|off>`",
    "`/calypso config review-recap-send-holidays:<on|off>`",
    "`/calypso config timezone:America/New_York` (shared timezone setting)",
    "Defaults: `1w`, `mon@09:00`, weekend sends `off`, holiday sends `off`, `America/New_York`.",
  ].join("\n");
}

function buildConfigHelpText(botName) {
  return [
    `*${botName} Config Help*`,
    "",
    "`/calypso config time-format:human|long` Configure timestamp display format.",
    "`/calypso config timezone:America/New_York` Configure timezone for human timestamps.",
    "",
    "*Platform Providers*",
    "`/calypso config communication-provider:slack|microsoft_teams`",
    "`/calypso config code-host-provider:github|bitbucket`",
    "`/calypso config deploy-provider:digitalocean|aws`",
    "Provider changes apply to command handling immediately.",
    "",
    "*Review Recap Config*",
    "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config review-recap-recency:<Nd|Nw>`",
    "`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/calypso config review-recap-send-weekends:<on|off>`",
    "`/calypso config review-recap-send-holidays:<on|off>`",
    "`/calypso config environment-status:on|off`",
    "`/calypso config environment-status-url:https://example.com/healthz`",
    "`/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config error-tracking:on|off`",
    "`/calypso config error-tracking-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config error-tracking-project:<PROJECT_SLUG>`",
    "`/calypso config error-tracking-environment:<ENVIRONMENT|any>`",
    "`/calypso config email-monitor:on|off`",
    "`/calypso config email-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`",
    "`/calypso config email-on-call off`",
    "`/calypso config timezone:America/New_York` Sets recap timezone too.",
  ].join("\n");
}

function buildHelpTopicUsageMessage() {
  return [
    "Usage:",
    "`/calypso help`",
    "`/calypso help testing`",
    "`/calypso help reviewing`",
    "`/calypso help config`",
  ].join("\n");
}

function normalizeHelpTopic(rawTopic) {
  if (rawTopic === undefined) {
    return "overview";
  }

  const normalizedTopic = String(rawTopic || "").toLowerCase().trim();
  if (normalizedTopic === "testing" || normalizedTopic === "tested") {
    return "testing";
  }
  if (
    normalizedTopic === "reviewing" ||
    normalizedTopic === "review" ||
    normalizedTopic === "reviews"
  ) {
    return "reviewing";
  }
  if (normalizedTopic === "config" || normalizedTopic === "configuration") {
    return "config";
  }

  return null;
}

module.exports = {
  HelpCommand,
};
