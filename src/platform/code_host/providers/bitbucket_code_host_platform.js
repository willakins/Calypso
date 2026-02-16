const { ProviderNotImplementedError } = require("../../shared/errors");
const { BaseCodeHostPlatform } = require("../base_code_host_platform");

class BitbucketCodeHostPlatform extends BaseCodeHostPlatform {
  constructor() {
    super({ provider: "bitbucket" });
  }

  assertAvailable() {
    throw new ProviderNotImplementedError({
      category: "code-host",
      provider: "bitbucket",
      detail: "set CODE_HOST_PROVIDER=github for now",
    });
  }
}

module.exports = {
  BitbucketCodeHostPlatform,
};
