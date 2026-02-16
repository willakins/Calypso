const { BaseCalypsoCommand } = require("./base_calypso_command");

const HELP_TEXT = [
  "*Calypso*",
  "Slack deployment gatekeeper.",
  "",
  "*Usage*",
  "`/calypso help` Show this message.",
  "`/calypso config time-format:human|long` Configure timestamp display format.",
  "`/calypso config timezone:America/New_York` Configure timezone for human timestamps.",
  "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>` Configure recap target channel.",
  "`/calypso config review-recap-recency:<Nd|Nw>` Configure recap lookback window.",
  "`/calypso config review-recap-schedule:<weekday>@HH:MM` Configure recap weekly send time.",
  "`/calypso config review-recap-timezone:America/New_York` Configure recap schedule timezone.",
  "`/calypso status` Show deploy blockers since last prod deploy.",
  "`/calypso tested <PR_NUMBER>` Mark a PR as tested.",
  "`/calypso tested all` Mark all untested PRs as tested.",
  "`/calypso tested recent <day|week|month>` List recently tested PRs.",
  "`/calypso whitelist <@USER>` Allow a user to run deploy commands (admin/whitelist).",
  "`/calypso deploy prod` Attempt prod deploy after gate check.",
  "`/calypso deploy prod force` Force deploy and bypass blockers.",
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
