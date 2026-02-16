const { createAwsCodePipelineClient } = require("./aws/client");
const { BaseDeployPlatform } = require("../base_deploy_platform");

class AwsDeployPlatform extends BaseDeployPlatform {
  constructor() {
    super({ provider: "aws" });
  }

  async triggerProductionDeployment(deployConfig) {
    const deployPipelineName = deployConfig.deployProductionAppId;
    const awsClient = this.buildAwsClient(deployConfig);

    return awsClient.triggerPipelineDeployment(deployPipelineName);
  }

  async waitForProductionDeploymentCompletion(deployConfig, externalDeployId) {
    const deployPipelineName = deployConfig.deployProductionAppId;
    const awsClient = this.buildAwsClient(deployConfig);

    const completion = await awsClient.waitForPipelineDeploymentCompletion(
      deployPipelineName,
      externalDeployId,
      {
        pollIntervalMs: deployConfig.deploymentPollIntervalMs,
        timeoutMs: deployConfig.deploymentTimeoutMs,
      },
    );

    return {
      ...completion,
      phase: completion.status,
    };
  }

  buildAwsClient(deployConfig) {
    return createAwsCodePipelineClient({
      accessKeyId: deployConfig.deployAccessKeyId,
      secretAccessKey: deployConfig.deploySecretAccessKey,
      sessionToken: deployConfig.deploySessionToken,
      region: deployConfig.deployRegion || "us-east-1",
    });
  }
}

module.exports = {
  AwsDeployPlatform,
};
