const { BaseCalypsoCommand } = require("./base_calypso_command");

const HELP_TEXT = [
  "*Calypso*",
  "Slack deployment gatekeeper.",
  "",
  "*Usage*",
  "`/calypso help` Show this message.",
  "`/calypso status` Show deploy blockers since last prod deploy.",
  "`/calypso tested <PR_NUMBER>` Mark a PR as tested.",
  "`/calypso deploy prod` Attempt prod deploy after gate check.",
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
