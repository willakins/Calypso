class BaseCommunicationPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  registerCalypsoCommand(_options = {}) {
    throw new Error(`${this.provider} communication platform must implement registerCalypsoCommand().`);
  }

  getCommandClient() {
    throw new Error(`${this.provider} communication platform must implement getCommandClient().`);
  }

  async start() {
    throw new Error(`${this.provider} communication platform must implement start().`);
  }

  async postChannelMessage(_options = {}) {
    throw new Error(`${this.provider} communication platform must implement postChannelMessage().`);
  }

  async isWorkspaceAdmin(_userId) {
    throw new Error(`${this.provider} communication platform must implement isWorkspaceAdmin().`);
  }

  async resolveUserDisplayName(_userId) {
    throw new Error(`${this.provider} communication platform must implement resolveUserDisplayName().`);
  }
}

module.exports = {
  BaseCommunicationPlatform,
};
