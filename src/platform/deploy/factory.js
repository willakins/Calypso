const { DEPLOY_PROVIDERS, DEFAULT_DEPLOY_PROVIDER } = require("../../config");
const { AwsDeployPlatform } = require("./providers/aws_deploy_platform");
const { DigitalOceanDeployPlatform } = require("./providers/digitalocean_deploy_platform");

const DEPLOY_PLATFORM_BUILDERS = Object.freeze({
  [DEPLOY_PROVIDERS.digitalocean]: () => new DigitalOceanDeployPlatform(),
  [DEPLOY_PROVIDERS.aws]: () => new AwsDeployPlatform(),
});

function createDeployPlatform(options = {}) {
  const provider = options.provider || DEFAULT_DEPLOY_PROVIDER;
  const buildPlatform = DEPLOY_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported deploy provider: ${provider}`);
  }

  const platform = buildPlatform();
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createDeployPlatform,
};
