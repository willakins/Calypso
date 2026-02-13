const { BaseCalypsoCommand } = require("./base_calypso_command");

class UnknownCommand extends BaseCalypsoCommand {
  constructor() {
    super("unknown");
  }

  parse({ commandText }) {
    return this.buildRespondParsedCommand(
      [`Unknown subcommand: \`${commandText}\``, "Run `/calypso help` for usage."].join("\n"),
    );
  }
}

module.exports = {
  UnknownCommand,
};
