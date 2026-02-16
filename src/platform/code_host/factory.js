const { CODE_HOST_PROVIDERS, DEFAULT_CODE_HOST_PROVIDER } = require("../../config");
const { BitbucketCodeHostPlatform } = require("./providers/bitbucket_code_host_platform");
const { GithubCodeHostPlatform } = require("./providers/github_code_host_platform");

const CODE_HOST_PLATFORM_BUILDERS = Object.freeze({
  [CODE_HOST_PROVIDERS.github]: ({ config }) => new GithubCodeHostPlatform({ config }),
  [CODE_HOST_PROVIDERS.bitbucket]: () => new BitbucketCodeHostPlatform(),
});

function createCodeHostPlatform(options = {}) {
  const provider = options.provider || DEFAULT_CODE_HOST_PROVIDER;
  const buildPlatform = CODE_HOST_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported code-host provider: ${provider}`);
  }

  const platform = buildPlatform({ config: options.config || {} });
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createCodeHostPlatform,
};
