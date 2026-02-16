const { COMMUNICATION_PROVIDERS, DEFAULT_COMMUNICATION_PROVIDER } = require("../../config");
const {
  MicrosoftTeamsCommunicationPlatform,
} = require("./providers/microsoft_teams_communication_platform");
const { SlackCommunicationPlatform } = require("./providers/slack_communication_platform");

const COMMUNICATION_PLATFORM_BUILDERS = Object.freeze({
  [COMMUNICATION_PROVIDERS.slack]: ({ config }) => new SlackCommunicationPlatform({ config }),
  [COMMUNICATION_PROVIDERS.microsoftTeams]: ({ config }) =>
    new MicrosoftTeamsCommunicationPlatform({ config }),
});

function createCommunicationPlatform(options = {}) {
  const provider = options.provider || DEFAULT_COMMUNICATION_PROVIDER;
  const buildPlatform = COMMUNICATION_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported communication provider: ${provider}`);
  }

  const platform = buildPlatform({ config: options.config || {} });
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createCommunicationPlatform,
};
