const { BaseCalypsoCommand } = require("./base_command");
const {
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEPLOY_PROVIDERS,
} = require("../../config");
const { parseDurationToken } = require("../../shared/durations");
const {
  readCommunicationUserReferenceFromArgument,
  resolveCommunicationChannelId,
  resolveCommunicationUserId,
  verifyCommunicationChannelAccess,
} = require("../../platform/communication/resolution");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;
const TIME_ZONE_ARGUMENT_PATTERN = /^timezone:(.+)$/i;
const REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN = /^review-recap-channel:(.+)$/i;
const REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN = /^review-recap-recency:(\d+)([dw])$/i;
const REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN =
  /^review-recap-schedule:(daily|mon|tue|wed|thu|fri|sat|sun)@(.+)$/i;
const REVIEW_RECAP_SEND_WEEKENDS_ARGUMENT_PATTERN = /^review-recap-send-weekends:(on|off)$/i;
const REVIEW_RECAP_SEND_HOLIDAYS_ARGUMENT_PATTERN = /^review-recap-send-holidays:(on|off)$/i;
const ENVIRONMENT_STATUS_ARGUMENT_PATTERN = /^environment-status:(on|off)$/i;
const ENVIRONMENT_STATUS_URL_ARGUMENT_PATTERN = /^environment-status-url:(.+)$/i;
const ENVIRONMENT_STATUS_CHANNEL_ARGUMENT_PATTERN = /^environment-status-channel:(.+)$/i;
const EMAIL_MONITOR_ARGUMENT_PATTERN = /^email-monitor:(on|off)$/i;
const EMAIL_CHANNEL_ARGUMENT_PATTERN = /^email-channel:(.+)$/i;
const REVIEW_RECAP_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_ON_CALL_COMMAND_NAME = "email-on-call";
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
const UNAVAILABLE_PROVIDERS = Object.freeze({});

class ConfigCommand extends BaseCalypsoCommand {
  constructor() {
    super("config");
  }

  parse({ commandWords }) {
    if (commandWords.length < 2) {
      return this.buildRespondParsedCommand(buildConfigUsageMessage());
    }

    const secondWord = String(commandWords[1] || "").toLowerCase();
    if (secondWord === EMAIL_ON_CALL_COMMAND_NAME) {
      return parseEmailOnCallCommand(this, commandWords);
    }

    if (commandWords.length !== 2) {
      return this.buildRespondParsedCommand(buildConfigUsageMessage());
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
      const targetChannelReference = String(recapChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }
      return this.buildParsedCommand({
        action: "config_review_recap_channel",
        targetChannelReference,
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
      const normalizedScheduleTime = normalizeReviewRecapScheduleTimes(recapScheduleMatch[2]);
      if (!normalizedScheduleTime) {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_review_recap_schedule",
        scheduleWeekday: recapScheduleMatch[1].toLowerCase(),
        scheduleTime: normalizedScheduleTime,
      });
    }

    const recapSendWeekendsMatch = argument.match(REVIEW_RECAP_SEND_WEEKENDS_ARGUMENT_PATTERN);
    if (recapSendWeekendsMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_send_weekends",
        sendOnWeekends: recapSendWeekendsMatch[1].toLowerCase() === "on",
      });
    }

    const recapSendHolidaysMatch = argument.match(REVIEW_RECAP_SEND_HOLIDAYS_ARGUMENT_PATTERN);
    if (recapSendHolidaysMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_send_holidays",
        sendOnHolidays: recapSendHolidaysMatch[1].toLowerCase() === "on",
      });
    }

    const environmentStatusMatch = argument.match(ENVIRONMENT_STATUS_ARGUMENT_PATTERN);
    if (environmentStatusMatch) {
      return this.buildParsedCommand({
        action: "config_environment_status",
        enabled: environmentStatusMatch[1].toLowerCase() === "on",
      });
    }

    const environmentStatusUrlMatch = argument.match(ENVIRONMENT_STATUS_URL_ARGUMENT_PATTERN);
    if (environmentStatusUrlMatch) {
      return this.buildParsedCommand({
        action: "config_environment_status_url",
        targetUrl: String(environmentStatusUrlMatch[1] || "").trim(),
      });
    }

    const environmentStatusChannelMatch = argument.match(ENVIRONMENT_STATUS_CHANNEL_ARGUMENT_PATTERN);
    if (environmentStatusChannelMatch) {
      const targetChannelReference = String(environmentStatusChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_environment_status_channel",
        targetChannelReference,
      });
    }

    const emailMonitorMatch = argument.match(EMAIL_MONITOR_ARGUMENT_PATTERN);
    if (emailMonitorMatch) {
      return this.buildParsedCommand({
        action: "config_email_monitor",
        enabled: emailMonitorMatch[1].toLowerCase() === "on",
      });
    }

    const emailChannelMatch = argument.match(EMAIL_CHANNEL_ARGUMENT_PATTERN);
    if (emailChannelMatch) {
      const targetChannelReference = String(emailChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_email_channel",
        targetChannelReference,
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

    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText || buildConfigUsageMessage());
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
      return updateChannelScopedConfig.call(this, {
        actionLabel: "review recap",
        runtime,
        retryCommand: "/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setReviewRecapChannelFn,
        successText: "Updated review recap channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
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

    if (parsedCommand.action === "config_review_recap_send_weekends") {
      await runtime.setReviewRecapSendWeekendsFn(
        runtime.pool,
        parsedCommand.sendOnWeekends,
        runtime.userId,
      );

      const weekendStatus = parsedCommand.sendOnWeekends ? "on" : "off";
      return this.buildExecutionResult(
        `Updated review recap weekend sending to \`${weekendStatus}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_send_holidays") {
      await runtime.setReviewRecapSendHolidaysFn(
        runtime.pool,
        parsedCommand.sendOnHolidays,
        runtime.userId,
      );

      const holidayStatus = parsedCommand.sendOnHolidays ? "on" : "off";
      return this.buildExecutionResult(
        `Updated review recap holiday sending to \`${holidayStatus}\` (US federal holidays).`,
      );
    }

    if (parsedCommand.action === "config_environment_status") {
      await runtime.setEnvironmentStatusEnabledFn(
        runtime.pool,
        parsedCommand.enabled,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated environment status monitoring to \`${parsedCommand.enabled ? "on" : "off"}\`.`,
      );
    }

    if (parsedCommand.action === "config_environment_status_url") {
      const normalizedTargetUrl = normalizeHttpUrl(parsedCommand.targetUrl);
      if (!normalizedTargetUrl) {
        return this.buildExecutionResult(
          [
            `Environment status URL \`${parsedCommand.targetUrl}\` is invalid.`,
            "Use an HTTP or HTTPS URL such as `https://example.com/healthz`.",
          ].join("\n"),
          { responseType: "ephemeral" },
        );
      }

      await runtime.setEnvironmentStatusUrlFn(
        runtime.pool,
        normalizedTargetUrl,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated environment status URL to \`${normalizedTargetUrl}\`.`,
      );
    }

    if (parsedCommand.action === "config_environment_status_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "environment status",
        runtime,
        retryCommand: "/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setEnvironmentStatusChannelFn,
        successText: "Updated environment status channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_email_monitor") {
      await runtime.setSupportEmailMonitorEnabledFn(
        runtime.pool,
        parsedCommand.enabled,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated support email monitoring to \`${parsedCommand.enabled ? "on" : "off"}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "support email",
        runtime,
        retryCommand: "/calypso config email-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setSupportEmailChannelFn,
        successText: "Updated support email channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_email_on_call") {
      const userResolution = await resolveCommunicationUserId(runtime, parsedCommand);
      if (!userResolution.isResolvable) {
        return this.buildExecutionResult(
          buildUserResolutionError({
            resolution: userResolution,
            targetUserHandle: userResolution.targetUserHandle || parsedCommand.targetUserHandle,
            usageCommand: "/calypso config email-on-call <@USER> 1d",
          }),
          { responseType: "ephemeral" },
        );
      }

      const expiresAt = new Date(Date.now() + parsedCommand.onCallDurationMs).toISOString();
      await runtime.setSupportEmailOnCallFn(
        runtime.pool,
        userResolution.targetUserId,
        expiresAt,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated support email on-call to <@${userResolution.targetUserId}> for \`${parsedCommand.onCallDurationToken}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_on_call_off") {
      await runtime.clearSupportEmailOnCallFn(runtime.pool, runtime.userId);
      return this.buildExecutionResult("Cleared support email on-call assignment.");
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

    if (parsedCommand.action !== "config_timezone") {
      return this.buildExecutionResult(buildConfigUsageMessage());
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

  resolveResponseType({ parsedCommand }) {
    if (isWorkspaceScopedConfigAction(parsedCommand.action)) {
      return "in_channel";
    }

    return "ephemeral";
  }
}

function isWorkspaceScopedConfigAction(action) {
  return (
    action === "config_review_recap_channel" ||
    action === "config_review_recap_recency" ||
    action === "config_review_recap_schedule" ||
    action === "config_review_recap_send_weekends" ||
    action === "config_review_recap_send_holidays" ||
    action === "config_environment_status" ||
    action === "config_environment_status_url" ||
    action === "config_environment_status_channel" ||
    action === "config_email_monitor" ||
    action === "config_email_channel" ||
    action === "config_email_on_call" ||
    action === "config_email_on_call_off" ||
    action === "config_communication_provider" ||
    action === "config_code_host_provider" ||
    action === "config_deploy_provider"
  );
}

function buildConfigUsageMessage() {
  return [
    "Usage:",
    "`/calypso config time-format:human`",
    "`/calypso config time-format:long`",
    "`/calypso config timezone:America/New_York`",
    "",
    "PR review recap setup:",
    "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "`/calypso config review-recap-recency:<Nd|Nw>`",
    "`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/calypso config review-recap-send-weekends:<on|off>`",
    "`/calypso config review-recap-send-holidays:<on|off>`",
    "",
    "Environment status setup:",
    "`/calypso config environment-status:on|off`",
    "`/calypso config environment-status-url:https://example.com/healthz`",
    "`/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "",
    "Support email setup:",
    "`/calypso config email-monitor:on|off`",
    "`/calypso config email-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "`/calypso config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`",
    "`/calypso config email-on-call off`",
    "",
    "Platform provider setup:",
    "`/calypso config communication-provider:slack|microsoft_teams`",
    "`/calypso config code-host-provider:github|bitbucket`",
    "`/calypso config deploy-provider:digitalocean|aws`",
    "Defaults: `1w`, `mon@09:00`, `send-weekends:off`, `send-holidays:off`, timezone from `/calypso config timezone`.",
  ].join("\n");
}

function parseEmailOnCallCommand(commandDefinition, commandWords) {
  if (commandWords.length === 3 && String(commandWords[2] || "").toLowerCase() === "off") {
    return commandDefinition.buildParsedCommand({
      action: "config_email_on_call_off",
    });
  }

  if (commandWords.length !== 4) {
    return commandDefinition.buildRespondParsedCommand(buildConfigUsageMessage());
  }

  const targetUserReference = readCommunicationUserReferenceFromArgument(commandWords[2]);
  const parsedDuration = parseDurationToken(commandWords[3]);
  if (!targetUserReference || !parsedDuration) {
    return commandDefinition.buildRespondParsedCommand(buildConfigUsageMessage());
  }

  return commandDefinition.buildParsedCommand({
    action: "config_email_on_call",
    ...targetUserReference,
    onCallDurationMs: parsedDuration.durationMs,
    onCallDurationToken: parsedDuration.normalizedToken,
  });
}

function normalizeReviewRecapScheduleTimes(rawScheduleTimes) {
  const scheduleTimeParts = String(rawScheduleTimes || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (scheduleTimeParts.length === 0) {
    return null;
  }

  const uniqueScheduleTimes = [...new Set(scheduleTimeParts)];
  for (const scheduleTime of uniqueScheduleTimes) {
    if (!REVIEW_RECAP_SCHEDULE_TIME_PATTERN.test(scheduleTime)) {
      return null;
    }
  }

  return uniqueScheduleTimes.sort().join(",");
}

async function updateChannelScopedConfig({
  actionLabel,
  runtime,
  retryCommand,
  setChannelFn,
  successText,
  targetChannelReference,
}) {
  const channelResolution = await resolveCommunicationChannelId(runtime, targetChannelReference);
  if (!channelResolution.isResolvable) {
    return this.buildExecutionResult(
      buildChannelResolutionError({
        actionLabel,
        botName: runtime.botName,
        reason: channelResolution.reason,
        targetChannelReference,
      }),
      { responseType: "ephemeral" },
    );
  }

  const channelAccess = await verifyCommunicationChannelAccess(runtime, channelResolution.targetChannelId);
  if (!channelAccess.isAccessible) {
    return this.buildExecutionResult(
      buildChannelAccessError({
        actionLabel,
        botName: runtime.botName,
        targetChannelId: channelResolution.targetChannelId,
        retryCommand,
        ...channelAccess,
      }),
      { responseType: "ephemeral" },
    );
  }

  await setChannelFn(runtime.pool, channelResolution.targetChannelId, runtime.userId);
  return this.buildExecutionResult(`${successText} to <#${channelResolution.targetChannelId}>.`);
}

function buildProviderArgumentPattern(prefix, providers) {
  return new RegExp(`^${prefix}:(${providers.join("|")})$`, "i");
}

function buildProviderUpdateMessage({ baseText }) {
  return baseText;
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

function buildChannelAccessError({
  actionLabel = "review recap",
  targetChannelId,
  reason,
  platformErrorCode,
  neededScopes,
  providedScopes,
  botName,
  retryCommand = "/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>",
}) {
  const resolvedBotName = String(botName || "Calypso").trim() || "Calypso";
  if (reason === "not_in_channel") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because ${resolvedBotName} is not in that channel.`,
      `Invite ${resolvedBotName} to the channel, then run \`${retryCommand}\` again.`,
    ].join(" ");
  }

  if (reason === "channel_not_found") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because that channel is not accessible.`,
      `Make sure the channel exists and ${resolvedBotName} has access.`,
    ].join(" ");
  }

  if (platformErrorCode === "missing_scope") {
    const neededText = neededScopes ? ` Needed scopes: \`${neededScopes}\`.` : "";
    const providedText = providedScopes ? ` Current scopes: \`${providedScopes}\`.` : "";
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack denied channel verification (\`missing_scope\`).`,
      `${resolvedBotName} needs channel read scopes to verify membership.${neededText}${providedText}`,
      "Reinstall/update the app scopes, then retry.",
    ].join(" ");
  }

  if (platformErrorCode === "not_allowed_token_type") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack rejected the token type (\`not_allowed_token_type\`).`,
      `Verify ${resolvedBotName} is using a bot token for Slack Web API calls, then retry.`,
    ].join(" ");
  }

  if (platformErrorCode === "invalid_auth" || platformErrorCode === "account_inactive") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack authentication failed (\`${platformErrorCode}\`).`,
      `Rotate/update ${resolvedBotName} communication credentials and retry.`,
    ].join(" ");
  }

  return [
    `Cannot set ${actionLabel} channel to <#${targetChannelId}> right now.`,
    `Slack could not verify access for ${resolvedBotName} (error: \`${platformErrorCode || "unknown_error"}\`).`,
    "Check channel ID, bot membership, and Slack app scopes, then try again.",
  ].join(" ");
}

function buildChannelResolutionError({
  actionLabel = "review recap",
  targetChannelReference,
  reason = "invalid_reference",
  botName,
}) {
  const resolvedBotName = String(botName || "Calypso").trim() || "Calypso";
  if (reason === "channel_not_found") {
    return [
      `Cannot set ${actionLabel} channel because \`${targetChannelReference}\` was not found.`,
      `Use a valid channel name, channel mention, or channel ID.`,
    ].join(" ");
  }

  if (reason === "channel_name_resolution_unavailable") {
    return [
      `Cannot resolve channel name \`${targetChannelReference}\` with current ${resolvedBotName} permissions.`,
      "Use a channel mention like `<#C123ABC|channel-name>` or a channel ID.",
    ].join(" ");
  }

  if (reason === "channel_name_resolution_failed") {
    return [
      `Cannot resolve channel name \`${targetChannelReference}\` right now.`,
      "Try again, or use a channel mention/channel ID instead.",
    ].join(" ");
  }

  return [
    `Invalid ${actionLabel} channel value \`${targetChannelReference}\`.`,
    "Use a channel mention like `<#C123ABC|channel-name>`, a channel ID, or a channel name such as `#deploys`.",
  ].join(" ");
}

function buildUserResolutionError({ resolution, targetUserHandle, usageCommand }) {
  const normalizedUserHandle = String(targetUserHandle || "").trim().toLowerCase();
  if (!normalizedUserHandle) {
    return `Usage: \`${usageCommand}\``;
  }

  if (resolution.reason === "user_lookup_unavailable") {
    return [
      `Cannot resolve \`@${normalizedUserHandle}\` with current Slack permissions.`,
      `Use \`${usageCommand}\` or a direct Slack user ID.`,
    ].join(" ");
  }

  if (resolution.platformErrorCode === "missing_scope") {
    const neededText = resolution.neededScopes ? ` Needed scopes: \`${resolution.neededScopes}\`.` : "";
    const providedText = resolution.providedScopes ? ` Current scopes: \`${resolution.providedScopes}\`.` : "";
    return [
      `Cannot resolve \`@${normalizedUserHandle}\` because Slack denied user lookup (\`missing_scope\`).`,
      `Grant the bot token user-read scope and reinstall the app.${neededText}${providedText}`,
      `Or use \`${usageCommand.replace("<@USER>", "U123ABC")}\`.`,
    ].join(" ");
  }

  if (resolution.reason === "user_not_found") {
    return [
      `Could not resolve \`@${normalizedUserHandle}\` to a Slack user.`,
      `Use \`${usageCommand}\` or a direct Slack user ID.`,
    ].join(" ");
  }

  return [
    `Cannot resolve \`@${normalizedUserHandle}\` right now (Slack error: \`${resolution.platformErrorCode || "unknown_error"}\`).`,
    `Use \`${usageCommand}\` or a direct Slack user ID.`,
  ].join(" ");
}

function normalizeHttpUrl(rawValue) {
  const normalizedValue = String(rawValue || "").trim();
  if (normalizedValue === "") {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch (_error) {
    return null;
  }
}

module.exports = {
  ConfigCommand,
};
