const { BaseCalypsoCommand } = require("./base_calypso_command");
const { DEFAULT_BOT_NAME } = require("../../config");

class SyncCommand extends BaseCalypsoCommand {
  constructor() {
    super("sync");
  }

  parse({ commandWords }) {
    if (commandWords.length !== 1) {
      return this.buildRespondParsedCommand("Usage: `/calypso sync`");
    }

    return this.buildParsedCommand({
      action: "sync_open_pr_review_state",
    });
  }

  async checkCallerAccess({ runtime }) {
    const syncAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!syncAccess.canDeploy) {
      return this.denyAccess(
        [
          "Sync denied.",
          "Only workspace admins or whitelisted users can run manual sync.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ runtime }) {
    if (typeof runtime.runOpenPullRequestSyncNowFn !== "function") {
      const botName = runtime.botName || DEFAULT_BOT_NAME;
      return this.buildExecutionResult(
        `Sync unavailable: configure \`CODE_HOST_TOKEN\` and restart ${botName}.`,
      );
    }

    try {
      const syncSummary = await runtime.runOpenPullRequestSyncNowFn();
      const upsertedCount = Number(syncSummary?.upsertedCount) || 0;
      const closedCount = Number(syncSummary?.closedCount) || 0;
      const mergedUntestedCount = Number(syncSummary?.mergedUntestedCount) || 0;

      return this.buildExecutionResult(
        [
          "Open PR sync completed successfully.",
          `Review sync: upserted ${upsertedCount} open PR(s), marked ${closedCount} stale PR(s) closed.`,
          `Untested merge sync: upserted ${mergedUntestedCount} merged untested PR(s).`,
        ].join(" "),
      );
    } catch (error) {
      return this.buildExecutionResult(
        `Open PR sync failed: ${error.message}`,
      );
    }
  }
}

module.exports = {
  SyncCommand,
};
