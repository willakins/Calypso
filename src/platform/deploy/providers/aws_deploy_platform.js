const { ProviderNotImplementedError } = require("../../shared/errors");
const { BaseDeployPlatform } = require("../base_deploy_platform");

class AwsDeployPlatform extends BaseDeployPlatform {
  constructor() {
    super({ provider: "aws" });
  }

  assertAvailable() {
    throw new ProviderNotImplementedError({
      category: "deploy",
      provider: "aws",
      detail: "set DEPLOY_PROVIDER=digitalocean for now",
    });
  }
}

module.exports = {
  AwsDeployPlatform,
};
