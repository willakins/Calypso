const { BaseCalypsoCommand } = require("./base_calypso_command");
const {
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEPLOY_PROVIDERS,
} = require("../../config");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;
const TIME_ZONE_ARGUMENT_PATTERN = /^timezone:(.+)$/i;
const REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN = /^review-recap-channel:(.+)$/i;
const REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN = /^review-recap-recency:(\d+)([dw])$/i;
const REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN =
  /^review-recap-schedule:(mon|tue|wed|thu|fri|sat|sun)@([01]\d|2[0-3]):([0-5]\d)$/i;
const COMMUNICATION_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "communication-provider",
  Object.values(COMMUNICATION_PROVIDERS),
);
const CODE_HOST_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "code-host-provider",
  Object.values(CODE_HOST_PROVIDERS),
);
const DEPLOY_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "deploy-provider",
  Object.values(DEPLOY_PROVIDERS),
);
const UNAVAILABLE_PROVIDERS = Object.freeze({
  [COMMUNICATION_PROVIDERS.microsoftTeams]: {
    category: "communication",
    availableOptions: [COMMUNICATION_PROVIDERS.slack],
  },
  [CODE_HOST_PROVIDERS.bitbucket]: {
    category: "code-host",
    availableOptions: [CODE_HOST_PROVIDERS.github],
  },
  [DEPLOY_PROVIDERS.aws]: {
    category: "deploy",
    availableOptions: [DEPLOY_PROVIDERS.digitalocean],
  },
});

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

    const recapChannelMatch = argument.match(REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN);
    if (recapChannelMatch) {
      const targetChannelId = normalizeSlackChannelId(recapChannelMatch[1]);
      if (!targetChannelId) {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }
      return this.buildParsedCommand({
        action: "config_review_recap_channel",
        targetChannelId,
      });
    }

    const recapRecencyMatch = argument.match(REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN);
    if (recapRecencyMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_recency",
        recencyValue: Number(recapRecencyMatch[1]),
        recencyUnit: recapRecencyMatch[2].toLowerCase(),
      });
    }

    const recapScheduleMatch = argument.match(REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN);
    if (recapScheduleMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_schedule",
        scheduleWeekday: recapScheduleMatch[1].toLowerCase(),
        scheduleTime: `${recapScheduleMatch[2]}:${recapScheduleMatch[3]}`,
      });
    }

    const communicationProviderMatch = argument.match(COMMUNICATION_PROVIDER_ARGUMENT_PATTERN);
    if (communicationProviderMatch) {
      return this.buildParsedCommand({
        action: "config_communication_provider",
        communicationProvider: communicationProviderMatch[1].toLowerCase(),
      });
    }

    const codeHostProviderMatch = argument.match(CODE_HOST_PROVIDER_ARGUMENT_PATTERN);
    if (codeHostProviderMatch) {
      return this.buildParsedCommand({
        action: "config_code_host_provider",
        codeHostProvider: codeHostProviderMatch[1].toLowerCase(),
      });
    }

    const deployProviderMatch = argument.match(DEPLOY_PROVIDER_ARGUMENT_PATTERN);
    if (deployProviderMatch) {
      return this.buildParsedCommand({
        action: "config_deploy_provider",
        deployProvider: deployProviderMatch[1].toLowerCase(),
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
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated your time format to \`${parsedCommand.timeFormat}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_channel") {
      await runtime.setReviewRecapChannelFn(
        runtime.pool,
        parsedCommand.targetChannelId,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap channel to <#${parsedCommand.targetChannelId}>.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_recency") {
      await runtime.setReviewRecapRecencyFn(
        runtime.pool,
        parsedCommand.recencyValue,
        parsedCommand.recencyUnit,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap recency to \`${parsedCommand.recencyValue}${parsedCommand.recencyUnit}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_schedule") {
      await runtime.setReviewRecapScheduleFn(
        runtime.pool,
        parsedCommand.scheduleWeekday,
        parsedCommand.scheduleTime,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap schedule to \`${parsedCommand.scheduleWeekday}@${parsedCommand.scheduleTime}\`.`,
      );
    }

    if (parsedCommand.action === "config_communication_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.communicationProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredCommunicationProviderFn(
        runtime.pool,
        parsedCommand.communicationProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated communication provider to \`${parsedCommand.communicationProvider}\`.`,
          provider: parsedCommand.communicationProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_code_host_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.codeHostProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredCodeHostProviderFn(
        runtime.pool,
        parsedCommand.codeHostProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated code-host provider to \`${parsedCommand.codeHostProvider}\`.`,
          provider: parsedCommand.codeHostProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_deploy_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.deployProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredDeployProviderFn(
        runtime.pool,
        parsedCommand.deployProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated deploy provider to \`${parsedCommand.deployProvider}\`.`,
          provider: parsedCommand.deployProvider,
        }),
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

    await runtime.setConfiguredTimeZoneFn(runtime.pool, parsedCommand.timeZone, runtime.userId);
    await runtime.setReviewRecapTimeZoneFn(runtime.pool, parsedCommand.timeZone, runtime.userId);

    return this.buildExecutionResult(
      [
        `Timezone \`${parsedCommand.timeZone}\` is valid.`,
        "Updated timezone for human timestamps and review recap schedule.",
      ].join(" "),
    );
  }
}

function normalizeSlackChannelId(rawChannelInput) {
  const candidateChannelInput = String(rawChannelInput || "").trim();
  if (candidateChannelInput === "") {
    return null;
  }

  const mentionMatch = candidateChannelInput.match(/^<#([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  return candidateChannelInput;
}

function buildConfigUsageMessage() {
  return [
    "Usage:",
    "`/calypso config time-format:human`",
    "`/calypso config time-format:long`",
    "`/calypso config timezone:America/New_York`",
    "",
    "PR review recap setup:",
    "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config review-recap-recency:<Nd|Nw>`",
    "`/calypso config review-recap-schedule:<weekday>@HH:MM`",
    "",
    "Platform provider setup:",
    "`/calypso config communication-provider:slack|microsoft_teams`",
    "`/calypso config code-host-provider:github|bitbucket`",
    "`/calypso config deploy-provider:digitalocean|aws`",
    "Defaults: `1w`, `mon@09:00`, timezone from `/calypso config timezone`.",
  ].join("\n");
}

function buildProviderArgumentPattern(prefix, providers) {
  return new RegExp(`^${prefix}:(${providers.join("|")})$`, "i");
}

function buildProviderUpdateMessage({ baseText }) {
  const messageLines = [
    baseText,
    "Restart Calypso for this change to take effect.",
  ];
  return messageLines.join(" ");
}

function buildProviderUnavailableMessage(provider) {
  const unavailableProvider = UNAVAILABLE_PROVIDERS[String(provider || "").toLowerCase()] || null;
  if (!unavailableProvider) {
    return null;
  }

  return [
    `Provider \`${provider}\` is not available yet.`,
    `Supported ${unavailableProvider.category} provider(s): \`${unavailableProvider.availableOptions.join(", ")}\`.`,
  ].join(" ");
}

module.exports = {
  ConfigCommand,
};
