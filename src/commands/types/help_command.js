const { BaseCalypsoCommand } = require("./base_calypso_command");

const HELP_TEXT = [
  "*Calypso*",
  "Slack deployment gatekeeper.",
  "",
  "*Usage*",
  "`/calypso help` Show this message.",
  "`/calypso config time-format:human|long` Configure timestamp display format.",
  "`/calypso config timezone:America/New_York` Configure timezone for human timestamps.",
  "`/calypso status` Show deploy blockers since last prod deploy.",
  "`/calypso reviews [<GITHUB_USER>] [<day|week|month>]` List open PRs waiting on review.",
  "`/calypso tested <PR_NUMBER>` Mark a PR as tested.",
  "`/calypso tested all` Mark all untested PRs as tested.",
  "`/calypso tested recent <day|week|month>` List recently tested PRs.",
  "`/calypso whitelist <@USER>` Allow a user to run deploy commands (admin/whitelist).",
  "`/calypso deploy prod` Attempt prod deploy after gate check.",
  "`/calypso deploy prod force` Force deploy and bypass blockers.",
  "",
  "*PR Review Recap Setup*",
  "1. Set a channel:",
  "   `/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
  "2. Set recency window (for example `1w`, `2w`, `2d`):",
  "   `/calypso config review-recap-recency:<Nd|Nw>`",
  "3. Set weekly send slot (24h clock):",
  "   `/calypso config review-recap-schedule:<weekday>@HH:MM`",
  "4. Set timezone:",
  "   `/calypso config review-recap-timezone:America/New_York`",
  "Defaults: `1w`, `mon@09:00`, `America/New_York`.",
].join("\n");

class HelpCommand extends BaseCalypsoCommand {
  constructor() {
    super("help");
  }

  parse() {
    return this.buildRespondParsedCommand(HELP_TEXT);
  }
}

module.exports = {
  HelpCommand,
};
