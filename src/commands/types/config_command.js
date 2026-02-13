const { BaseCalypsoCommand } = require("./base_calypso_command");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;
const TIME_ZONE_ARGUMENT_PATTERN = /^timezone:(.+)$/i;

class ConfigCommand extends BaseCalypsoCommand {
  constructor() {
    super("config");
  }

  parse({ commandWords }) {
    if (commandWords.length !== 2) {
      return this.buildRespondParsedCommand(
        buildConfigUsageMessage(),
      );
    }

    const argument = commandWords[1];
    const match = argument.match(TIME_FORMAT_ARGUMENT_PATTERN);
    if (match) {
      return this.buildParsedCommand({
        action: "config_time_format",
        timeFormat: match[1].toLowerCase(),
      });
    }

    const timezoneMatch = argument.match(TIME_ZONE_ARGUMENT_PATTERN);
    if (timezoneMatch) {
      return this.buildParsedCommand({
        action: "config_timezone",
        timeZone: timezoneMatch[1].trim(),
      });
    }

    return this.buildRespondParsedCommand(buildConfigUsageMessage());
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

    if (parsedCommand.action === "config_time_format") {
      await runtime.setConfiguredTimeFormatFn(
        runtime.pool,
        parsedCommand.timeFormat,
        runtime.slackUserId,
      );

      return this.buildExecutionResult(
        `Updated your time format to \`${parsedCommand.timeFormat}\`.`,
      );
    }

    if (!runtime.isValidTimeZoneFn(parsedCommand.timeZone)) {
      return this.buildExecutionResult(
        [
          `Timezone \`${parsedCommand.timeZone}\` is invalid.`,
          "Use an IANA timezone such as `America/New_York`.",
        ].join("\n"),
      );
    }

    await runtime.setConfiguredTimeZoneFn(
      runtime.pool,
      parsedCommand.timeZone,
      runtime.slackUserId,
    );

    return this.buildExecutionResult(
      `Timezone \`${parsedCommand.timeZone}\` is valid. Updated your timezone setting.`,
    );
  }
}

function buildConfigUsageMessage() {
  return [
    "Usage:",
    "`/calypso config time-format:human`",
    "`/calypso config time-format:long`",
    "`/calypso config timezone:America/New_York`",
  ].join("\n");
}

module.exports = {
  ConfigCommand,
};
