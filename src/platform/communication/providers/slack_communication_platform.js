const { App } = require("@slack/bolt");

const { registerCalypsoCommand } = require("../../../commands/calypso");
const { BaseCommunicationPlatform } = require("../base_communication_platform");

class SlackCommunicationPlatform extends BaseCommunicationPlatform {
  constructor({ config }) {
    super({ provider: "slack" });
    this.app = new App({
      token: config.communicationBotToken || config.slackBotToken,
      appToken: config.communicationAppToken || config.slackAppToken,
      socketMode: true,
    });
  }

  registerCalypsoCommand(options = {}) {
    registerCalypsoCommand(this.app, options);
  }

  getCommandClient() {
    return this.app.client;
  }

  async start() {
    await this.app.start();
  }

  async postChannelMessage({ channelId, mrkdwn = true, text }) {
    await this.app.client.chat.postMessage({
      channel: channelId,
      mrkdwn,
      text,
    });
  }

  async isWorkspaceAdmin(userId) {
    if (!userId) {
      return false;
    }

    try {
      const response = await this.app.client.users.info({ user: userId });
      const user = response.user || {};
      return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
    } catch (_error) {
      return false;
    }
  }

  async resolveUserDisplayName(userId) {
    if (!userId) {
      return null;
    }

    try {
      const response = await this.app.client.users.info({ user: userId });
      const user = response.user || {};
      const profile = user.profile || {};
      return profile.display_name || profile.real_name || user.name || null;
    } catch (_error) {
      return null;
    }
  }
}

module.exports = {
  SlackCommunicationPlatform,
};
