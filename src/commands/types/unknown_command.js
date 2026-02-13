const { BaseCalypsoCommand } = require("./base_calypso_command");

class UnknownCommand extends BaseCalypsoCommand {
  constructor() {
    super("unknown");
  }

  parse() {
    return this.buildRespondParsedCommand("Unknown subcommand. Run `/calypso help` for usage.");
  }
}

module.exports = {
  UnknownCommand,
};
