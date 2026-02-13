const { BaseCalypsoCommand } = require("./base_calypso_command");

class WhitelistCommand extends BaseCalypsoCommand {
  constructor() {
    super("whitelist");
  }

  parse({ commandWords }) {
    const targetArgument = commandWords.slice(1).join(" ").trim();
    const targetUserId = readSlackUserIdFromArgument(targetArgument);

    if (!targetUserId) {
      return this.buildRespondParsedCommand("Usage: `/calypso whitelist <@USER>`");
    }

    return this.buildParsedCommand({
      action: "whitelist_add",
      targetUserId,
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
    if (!runtime.pool) {
      return this.buildExecutionResult(
        "Whitelist command unavailable: database pool is not configured.",
      );
    }

    const result = await runtime.addUserToDeployWhitelistFn(
      runtime.pool,
      parsedCommand.targetUserId,
      runtime.slackUserId,
    );

    if (!result.added) {
      return this.buildExecutionResult(
        `<@${parsedCommand.targetUserId}> is already in deploy whitelist.`,
      );
    }

    return this.buildExecutionResult(
      `Added <@${parsedCommand.targetUserId}> to deploy whitelist.`,
    );
  }
}

function readSlackUserIdFromArgument(argument) {
  if (!argument) {
    return null;
  }

  const mentionMatch = argument.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/i);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  const directIdMatch = argument.match(/^([UW][A-Z0-9]+)$/i);
  if (directIdMatch) {
    return directIdMatch[1].toUpperCase();
  }

  return null;
}

module.exports = {
  WhitelistCommand,
};
