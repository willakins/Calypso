class BaseDeployPlatform {
  constructor({ provider }) {
    this.provider = provider;
  }

  assertAvailable() {
    return;
  }

  async triggerProductionDeployment(_deployConfig) {
    throw new Error(`${this.provider} deploy platform must implement triggerProductionDeployment().`);
  }

  async waitForProductionDeploymentCompletion(_deployConfig, _externalDeployId) {
    throw new Error(
      `${this.provider} deploy platform must implement waitForProductionDeploymentCompletion().`,
    );
  }
}

module.exports = {
  BaseDeployPlatform,
};
