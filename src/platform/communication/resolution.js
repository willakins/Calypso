function readCommunicationUserReferenceFromArgument(argument) {
  const normalizedArgument = String(argument || "").trim();
  if (normalizedArgument === "") {
    return null;
  }

  const mentionMatch = normalizedArgument.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/i);
  if (mentionMatch) {
    return {
      targetUserId: mentionMatch[1].toUpperCase(),
    };
  }

  const directIdMatch = normalizedArgument.match(/^([UW][A-Z0-9]+)$/i);
  if (directIdMatch) {
    return {
      targetUserId: directIdMatch[1].toUpperCase(),
    };
  }

  const handleMatch = normalizedArgument.match(/^@([a-z0-9][a-z0-9._-]*)$/i);
  if (handleMatch) {
    return {
      targetUserHandle: handleMatch[1].toLowerCase(),
    };
  }

  return null;
}

async function resolveCommunicationUserId(runtime, targetUserReference) {
  const targetUserId = String(targetUserReference?.targetUserId || "").trim().toUpperCase();
  if (targetUserId !== "") {
    return {
      isResolvable: true,
      targetUserId,
    };
  }

  const targetUserHandle = String(targetUserReference?.targetUserHandle || "").trim().toLowerCase();
  if (targetUserHandle === "") {
    return {
      isResolvable: false,
      reason: "invalid_reference",
    };
  }

  const usersApi = runtime.communicationClient?.users;
  if (!usersApi || typeof usersApi.list !== "function") {
    return {
      isResolvable: false,
      reason: "user_lookup_unavailable",
      targetUserHandle,
    };
  }

  try {
    const resolvedUserId = await findCommunicationUserIdByHandle(usersApi, targetUserHandle);
    if (!resolvedUserId) {
      return {
        isResolvable: false,
        reason: "user_not_found",
        targetUserHandle,
      };
    }

    return {
      isResolvable: true,
      targetUserId: resolvedUserId,
      targetUserHandle,
    };
  } catch (error) {
    return {
      isResolvable: false,
      reason: "lookup_failed",
      targetUserHandle,
      platformErrorCode: readPlatformErrorCode(error),
      neededScopes: readPlatformNeededScopes(error),
      providedScopes: readPlatformProvidedScopes(error),
    };
  }
}

async function resolveCommunicationChannelId(runtime, targetChannelReference) {
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
      targetChannelReference: reference,
    };
  }

  try {
    const matchedChannel = await findCommunicationChannel(conversationsApi, (channel) => {
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
      targetChannelReference: reference,
    };
  }

  return {
    isResolvable: false,
    reason: "channel_not_found",
    targetChannelReference: reference,
  };
}

async function verifyCommunicationChannelAccess(runtime, targetChannelId) {
  const conversationsApi = runtime.communicationClient?.conversations;
  if (!conversationsApi || typeof conversationsApi.list !== "function") {
    return { isAccessible: true };
  }

  try {
    const matchedChannel = await findCommunicationChannel(conversationsApi, (channel) => {
      return normalizeChannelId(channel?.id) === normalizeChannelId(targetChannelId);
    });
    if (!matchedChannel) {
      return {
        isAccessible: false,
        reason: "not_in_channel",
      };
    }

    if (matchedChannel?.is_member === false) {
      return {
        isAccessible: false,
        reason: "not_in_channel",
      };
    }

    return { isAccessible: true };
  } catch (error) {
    const platformErrorCode = readPlatformErrorCode(error);
    if (platformErrorCode === "not_in_channel" || platformErrorCode === "channel_not_found") {
      return {
        isAccessible: false,
        reason: platformErrorCode,
        platformErrorCode,
      };
    }

    return {
      isAccessible: false,
      reason: "verification_failed",
      platformErrorCode: platformErrorCode || "unknown_error",
      neededScopes: readPlatformNeededScopes(error),
      providedScopes: readPlatformProvidedScopes(error),
    };
  }
}

async function findCommunicationUserIdByHandle(usersApi, targetUserHandle) {
  let cursor = null;

  while (true) {
    const response = await usersApi.list({
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    const members = Array.isArray(response?.members) ? response.members : [];

    const matchedMember = members.find((member) => {
      if (member?.deleted) {
        return false;
      }

      const normalizedUserName = String(member?.name || "").trim().toLowerCase();
      return normalizedUserName !== "" && normalizedUserName === targetUserHandle;
    });
    if (matchedMember?.id) {
      return String(matchedMember.id).trim().toUpperCase();
    }

    cursor = String(response?.response_metadata?.next_cursor || "").trim();
    if (cursor === "") {
      return null;
    }
  }
}

async function findCommunicationChannel(conversationsApi, matcher) {
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
  if (errorMessage.includes("missing_scope")) {
    return "missing_scope";
  }
  if (errorMessage.includes("invalid_auth")) {
    return "invalid_auth";
  }
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

module.exports = {
  readCommunicationUserReferenceFromArgument,
  readPlatformErrorCode,
  readPlatformNeededScopes,
  readPlatformProvidedScopes,
  resolveCommunicationChannelId,
  resolveCommunicationUserId,
  verifyCommunicationChannelAccess,
};
