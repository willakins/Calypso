const { BaseCalypsoCommand } = require("./base_calypso_command");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;
const TIME_ZONE_ARGUMENT_PATTERN = /^timezone:(.+)$/i;
const REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN = /^review-recap-channel:(.+)$/i;
const REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN = /^review-recap-recency:(\d+)([dw])$/i;
const REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN =
  /^review-recap-schedule:(mon|tue|wed|thu|fri|sat|sun)@([01]\d|2[0-3]):([0-5]\d)$/i;
const REVIEW_RECAP_TIME_ZONE_ARGUMENT_PATTERN = /^review-recap-timezone:(.+)$/i;

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

    const recapTimeZoneMatch = argument.match(REVIEW_RECAP_TIME_ZONE_ARGUMENT_PATTERN);
    if (recapTimeZoneMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_timezone",
        timeZone: recapTimeZoneMatch[1].trim(),
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

    if (parsedCommand.action === "config_review_recap_channel") {
      await runtime.setReviewRecapChannelFn(
        runtime.pool,
        parsedCommand.targetChannelId,
        runtime.slackUserId,
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
        runtime.slackUserId,
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
        runtime.slackUserId,
      );

      return this.buildExecutionResult(
        `Updated review recap schedule to \`${parsedCommand.scheduleWeekday}@${parsedCommand.scheduleTime}\`.`,
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

    if (parsedCommand.action === "config_review_recap_timezone") {
      await runtime.setReviewRecapTimeZoneFn(
        runtime.pool,
        parsedCommand.timeZone,
        runtime.slackUserId,
      );

      return this.buildExecutionResult(
        `Timezone \`${parsedCommand.timeZone}\` is valid. Updated review recap timezone.`,
      );
    }

    await runtime.setConfiguredTimeZoneFn(runtime.pool, parsedCommand.timeZone, runtime.slackUserId);

    return this.buildExecutionResult(
      `Timezone \`${parsedCommand.timeZone}\` is valid. Updated your timezone setting.`,
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
    "`/calypso config review-recap-timezone:America/New_York`",
    "Defaults: `1w`, `mon@09:00`, `America/New_York`.",
  ].join("\n");
}

module.exports = {
  ConfigCommand,
};
