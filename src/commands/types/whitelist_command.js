const { BaseCalypsoCommand } = require("./base_command");

class WhitelistCommand extends BaseCalypsoCommand {
  constructor() {
    super("whitelist");
  }

  parse({ commandWords }) {
    const targetArgument = commandWords.slice(1).join(" ").trim();
    const targetUserReference = readSlackUserReferenceFromArgument(targetArgument);

    if (!targetUserReference) {
      return this.buildRespondParsedCommand("Usage: `/calypso whitelist <@USER>`");
    }

    return this.buildParsedCommand({
      action: "whitelist_add",
      ...targetUserReference,
    });
  }

  async checkCallerAccess({ runtime }) {
    const whitelistAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!whitelistAccess.canDeploy) {
      return this.denyAccess(
        "Only workspace admins or whitelisted users can manage deploy whitelist.",
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(
        parsedCommand.responseText || "Usage: `/calypso whitelist <@USER>`",
      );
    }

    if (!runtime.pool) {
      return this.buildExecutionResult(
        "Whitelist command unavailable: database pool is not configured.",
      );
    }

    const targetUserIdResolution = await resolveTargetUserId(runtime, parsedCommand);
    if (!targetUserIdResolution.isResolvable) {
      return this.buildExecutionResult(targetUserIdResolution.reasonText);
    }

    const result = await runtime.addUserToDeployWhitelistFn(
      runtime.pool,
      targetUserIdResolution.targetUserId,
      runtime.userId,
    );

    if (!result.added) {
      return this.buildExecutionResult(
        `<@${targetUserIdResolution.targetUserId}> is already in deploy whitelist.`,
      );
    }

    return this.buildExecutionResult(
      `Added <@${targetUserIdResolution.targetUserId}> to deploy whitelist.`,
    );
  }
}

function readSlackUserReferenceFromArgument(argument) {
  if (!argument) {
    return null;
  }

  const mentionMatch = argument.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/i);
  if (mentionMatch) {
    return {
      targetUserId: mentionMatch[1].toUpperCase(),
    };
  }

  const directIdMatch = argument.match(/^([UW][A-Z0-9]+)$/i);
  if (directIdMatch) {
    return {
      targetUserId: directIdMatch[1].toUpperCase(),
    };
  }

  const handleMatch = argument.match(/^@([a-z0-9][a-z0-9._-]*)$/i);
  if (handleMatch) {
    return {
      targetUserHandle: handleMatch[1].toLowerCase(),
    };
  }

  return null;
}

async function resolveTargetUserId(runtime, parsedCommand) {
  const targetUserId = String(parsedCommand.targetUserId || "").trim().toUpperCase();
  if (targetUserId !== "") {
    return {
      isResolvable: true,
      targetUserId,
    };
  }

  const targetUserHandle = String(parsedCommand.targetUserHandle || "").trim().toLowerCase();
  if (targetUserHandle === "") {
    return {
      isResolvable: false,
      reasonText: "Usage: `/calypso whitelist <@USER>`",
    };
  }

  const usersApi = runtime.communicationClient?.users;
  if (!usersApi || typeof usersApi.list !== "function") {
    return {
      isResolvable: false,
      reasonText: [
        `Cannot resolve \`@${targetUserHandle}\` with current Slack permissions.`,
        "Use `/calypso whitelist <@USER>` or `/calypso whitelist U123ABC`.",
      ].join(" "),
    };
  }

  let resolvedUserId = null;
  try {
    resolvedUserId = await findSlackUserIdByHandle(usersApi, targetUserHandle);
  } catch (error) {
    const errorCode = readSlackApiErrorCode(error);
    if (errorCode === "missing_scope") {
      const neededScopes = normalizeScopeList(error?.data?.needed);
      const providedScopes = normalizeScopeList(error?.data?.provided);
      const neededText = neededScopes ? ` Needed scopes: \`${neededScopes}\`.` : "";
      const providedText = providedScopes ? ` Current scopes: \`${providedScopes}\`.` : "";
      return {
        isResolvable: false,
        reasonText: [
          `Cannot resolve \`@${targetUserHandle}\` because Slack denied user lookup (\`missing_scope\`).`,
          `Grant the bot token user-read scope and reinstall the app.${neededText}${providedText}`,
          "Or whitelist using a direct Slack user ID: `/calypso whitelist U123ABC`.",
        ].join(" "),
      };
    }

    return {
      isResolvable: false,
      reasonText: [
        `Cannot resolve \`@${targetUserHandle}\` right now (Slack error: \`${errorCode || "unknown_error"}\`).`,
        "Use `/calypso whitelist <@USER>` or `/calypso whitelist U123ABC`.",
      ].join(" "),
    };
  }

  if (!resolvedUserId) {
    return {
      isResolvable: false,
      reasonText: [
        `Could not resolve \`@${targetUserHandle}\` to a Slack user.`,
        "Use `/calypso whitelist <@USER>` or `/calypso whitelist U123ABC`.",
      ].join(" "),
    };
  }

  return {
    isResolvable: true,
    targetUserId: resolvedUserId,
  };
}

async function findSlackUserIdByHandle(usersApi, targetUserHandle) {
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

function readSlackApiErrorCode(error) {
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

  return "";
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
  WhitelistCommand,
};
