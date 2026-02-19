const { BaseCalypsoCommand } = require("./base_command");
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
  /^review-recap-schedule:(daily|mon|tue|wed|thu|fri|sat|sun)@(.+)$/i;
const REVIEW_RECAP_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
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
      const channelResolution = await resolveReviewRecapChannelId(
        runtime,
        parsedCommand.targetChannelReference,
      );
      if (!channelResolution.isResolvable) {
        return this.buildExecutionResult(
          buildReviewRecapChannelResolutionError({
            targetChannelReference: parsedCommand.targetChannelReference,
            reason: channelResolution.reason,
            botName: runtime.botName,
          }),
          { responseType: "ephemeral" },
        );
      }

      const channelAccess = await verifyReviewRecapChannelAccess(
        runtime,
        channelResolution.targetChannelId,
      );
      if (!channelAccess.isAccessible) {
        return this.buildExecutionResult(
          buildReviewRecapChannelAccessError({
            targetChannelId: channelResolution.targetChannelId,
            reason: channelAccess.reason,
            platformErrorCode: channelAccess.platformErrorCode,
            neededScopes: channelAccess.neededScopes,
            providedScopes: channelAccess.providedScopes,
            botName: runtime.botName,
          }),
          { responseType: "ephemeral" },
        );
      }

      await runtime.setReviewRecapChannelFn(
        runtime.pool,
        channelResolution.targetChannelId,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap channel to <#${channelResolution.targetChannelId}>.`,
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
    "",
    "Platform provider setup:",
    "`/calypso config communication-provider:slack|microsoft_teams`",
    "`/calypso config code-host-provider:github|bitbucket`",
    "`/calypso config deploy-provider:digitalocean|aws`",
    "Defaults: `1w`, `mon@09:00`, timezone from `/calypso config timezone`.",
  ].join("\n");
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

async function verifyReviewRecapChannelAccess(runtime, targetChannelId) {
  if (typeof runtime.verifyReviewRecapChannelAccessFn === "function") {
    return runtime.verifyReviewRecapChannelAccessFn(runtime, targetChannelId);
  }

  const conversationsApi = runtime.communicationClient?.conversations;
  if (!conversationsApi || typeof conversationsApi.list !== "function") {
    return { isAccessible: true };
  }

  try {
    const matchedChannel = await findPublicOrPrivateChannel(conversationsApi, (channel) => {
      return normalizeChannelId(channel?.id) === normalizeChannelId(targetChannelId);
    });
    if (!matchedChannel) {
      return {
        isAccessible: false,
        reason: "not_in_channel",
      };
    }

    const isMember = matchedChannel?.is_member;
    if (isMember === false) {
      return {
        isAccessible: false,
        reason: "not_in_channel",
      };
    }

    return { isAccessible: true };
  } catch (error) {
    const errorCode = readPlatformErrorCode(error);
    if (errorCode === "not_in_channel" || errorCode === "channel_not_found") {
      return {
        isAccessible: false,
        reason: errorCode,
        platformErrorCode: errorCode,
      };
    }

    return {
      isAccessible: false,
      reason: "verification_failed",
      platformErrorCode: errorCode || "unknown_error",
      neededScopes: readPlatformNeededScopes(error),
      providedScopes: readPlatformProvidedScopes(error),
    };
  }
}

async function resolveReviewRecapChannelId(runtime, targetChannelReference) {
  const reference = String(targetChannelReference || "").trim();
  if (reference === "") {
    return {
      isResolvable: false,
      reason: "invalid_reference",
    };
  }

  const mentionMatch = reference.match(/^<#([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return {
      isResolvable: true,
      targetChannelId: mentionMatch[1].toUpperCase(),
    };
  }

  const channelIdMatch = reference.match(/^[CG][A-Z0-9]+$/i);
  if (channelIdMatch) {
    return {
      isResolvable: true,
      targetChannelId: reference.toUpperCase(),
    };
  }

  const channelNameMatch = reference.match(/^#?([a-z0-9][a-z0-9._-]*)$/i);
  if (!channelNameMatch) {
    return {
      isResolvable: false,
      reason: "invalid_reference",
    };
  }

  const channelName = channelNameMatch[1].toLowerCase();
  const currentChannelId = String(runtime.currentChannelId || "").trim();
  const currentChannelName = String(runtime.currentChannelName || "").trim().toLowerCase();
  if (currentChannelId !== "" && currentChannelName !== "" && currentChannelName === channelName) {
    return {
      isResolvable: true,
      targetChannelId: currentChannelId.toUpperCase(),
    };
  }

  const conversationsApi = runtime.communicationClient?.conversations;
  if (!conversationsApi || typeof conversationsApi.list !== "function") {
    return {
      isResolvable: false,
      reason: "channel_name_resolution_unavailable",
    };
  }

  try {
    const matchedChannel = await findPublicOrPrivateChannel(conversationsApi, (channel) => {
      const normalizedName = String(channel?.name_normalized || "").toLowerCase();
      const name = String(channel?.name || "").toLowerCase();
      return normalizedName === channelName || name === channelName;
    });
    if (matchedChannel?.id) {
      return {
        isResolvable: true,
        targetChannelId: String(matchedChannel.id).toUpperCase(),
      };
    }
  } catch (_error) {
    return {
      isResolvable: false,
      reason: "channel_name_resolution_failed",
    };
  }

  return {
    isResolvable: false,
    reason: "channel_not_found",
  };
}

async function findPublicOrPrivateChannel(conversationsApi, matcher) {
  let cursor = null;
  while (true) {
    const response = await conversationsApi.list({
      exclude_archived: true,
      limit: 200,
      types: "public_channel,private_channel",
      ...(cursor ? { cursor } : {}),
    });

    const channels = Array.isArray(response?.channels) ? response.channels : [];
    const matchedChannel = channels.find(matcher);
    if (matchedChannel) {
      return matchedChannel;
    }

    cursor = String(response?.response_metadata?.next_cursor || "").trim();
    if (cursor === "") {
      return null;
    }
  }
}

function normalizeChannelId(channelId) {
  return String(channelId || "").trim().toUpperCase();
}

function readPlatformErrorCode(error) {
  const payloadErrorCode = String(error?.data?.error || "").trim().toLowerCase();
  if (payloadErrorCode !== "") {
    return payloadErrorCode;
  }

  const errorMessage = String(error?.message || "").trim().toLowerCase();
  if (errorMessage.includes("not_in_channel")) {
    return "not_in_channel";
  }
  if (errorMessage.includes("channel_not_found")) {
    return "channel_not_found";
  }

  return "";
}

function readPlatformNeededScopes(error) {
  return normalizeScopeList(error?.data?.needed);
}

function readPlatformProvidedScopes(error) {
  return normalizeScopeList(error?.data?.provided);
}

function normalizeScopeList(rawScopes) {
  const rawValue = String(rawScopes || "").trim();
  if (rawValue === "") {
    return null;
  }

  return rawValue
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(", ");
}

function buildReviewRecapChannelAccessError({
  targetChannelId,
  reason,
  platformErrorCode,
  neededScopes,
  providedScopes,
  botName,
}) {
  const resolvedBotName = String(botName || "Calypso").trim() || "Calypso";
  if (reason === "not_in_channel") {
    return [
      `Cannot set review recap channel to <#${targetChannelId}> because ${resolvedBotName} is not in that channel.`,
      `Invite ${resolvedBotName} to the channel, then run \`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>\` again.`,
    ].join(" ");
  }

  if (reason === "channel_not_found") {
    return [
      `Cannot set review recap channel to <#${targetChannelId}> because that channel is not accessible.`,
      `Make sure the channel exists and ${resolvedBotName} has access.`,
    ].join(" ");
  }

  if (platformErrorCode === "missing_scope") {
    const neededText = neededScopes ? ` Needed scopes: \`${neededScopes}\`.` : "";
    const providedText = providedScopes ? ` Current scopes: \`${providedScopes}\`.` : "";
    return [
      `Cannot set review recap channel to <#${targetChannelId}> because Slack denied channel verification (\`missing_scope\`).`,
      `${resolvedBotName} needs channel read scopes to verify membership.${neededText}${providedText}`,
      "Reinstall/update the app scopes, then retry.",
    ].join(" ");
  }

  if (platformErrorCode === "not_allowed_token_type") {
    return [
      `Cannot set review recap channel to <#${targetChannelId}> because Slack rejected the token type (\`not_allowed_token_type\`).`,
      `Verify ${resolvedBotName} is using a bot token for Slack Web API calls, then retry.`,
    ].join(" ");
  }

  if (platformErrorCode === "invalid_auth" || platformErrorCode === "account_inactive") {
    return [
      `Cannot set review recap channel to <#${targetChannelId}> because Slack authentication failed (\`${platformErrorCode}\`).`,
      `Rotate/update ${resolvedBotName} communication credentials and retry.`,
    ].join(" ");
  }

  return [
    `Cannot set review recap channel to <#${targetChannelId}> right now.`,
    `Slack could not verify access for ${resolvedBotName} (error: \`${platformErrorCode || "unknown_error"}\`).`,
    "Check channel ID, bot membership, and Slack app scopes, then try again.",
  ].join(" ");
}

function buildReviewRecapChannelResolutionError({ targetChannelReference, reason, botName }) {
  const resolvedBotName = String(botName || "Calypso").trim() || "Calypso";
  if (reason === "channel_not_found") {
    return [
      `Cannot set review recap channel because \`${targetChannelReference}\` was not found.`,
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
    `Invalid review recap channel value \`${targetChannelReference}\`.`,
    "Use a channel mention like `<#C123ABC|channel-name>`, a channel ID, or a channel name such as `#deploys`.",
  ].join(" ");
}

module.exports = {
  ConfigCommand,
};
