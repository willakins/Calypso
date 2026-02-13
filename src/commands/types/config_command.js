const { BaseCalypsoCommand } = require("./base_calypso_command");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;

class ConfigCommand extends BaseCalypsoCommand {
  constructor() {
    super("config");
  }

  parse({ commandWords }) {
    if (commandWords.length !== 2) {
      return this.buildRespondParsedCommand(
        "Usage: `/calypso config time-format:human` or `/calypso config time-format:long`",
      );
    }

    const argument = commandWords[1];
    const match = argument.match(TIME_FORMAT_ARGUMENT_PATTERN);
    if (!match) {
      return this.buildRespondParsedCommand(
        "Usage: `/calypso config time-format:human` or `/calypso config time-format:long`",
      );
    }

    return this.buildParsedCommand({
      action: "config_time_format",
      timeFormat: match[1].toLowerCase(),
    });
  }

  async checkCallerAccess({ runtime }) {
    const configAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!configAccess.canDeploy) {
      return this.denyAccess(
        [
          "Config update denied.",
          "Only workspace admins or whitelisted users can update config.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Config command unavailable: database pool is not configured.");
    }

    await runtime.setConfiguredTimeFormatFn(
      runtime.pool,
      parsedCommand.timeFormat,
      runtime.slackUserId,
    );

    return this.buildExecutionResult(
      `Updated time format to \`${parsedCommand.timeFormat}\`.`,
    );
  }
}

module.exports = {
  ConfigCommand,
};
