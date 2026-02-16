const { ProviderNotImplementedError } = require("../../shared/errors");
const { BaseCommunicationPlatform } = require("../base_communication_platform");

class MicrosoftTeamsCommunicationPlatform extends BaseCommunicationPlatform {
  constructor() {
    super({ provider: "microsoft_teams" });
  }

  assertAvailable() {
    throw new ProviderNotImplementedError({
      category: "communication",
      provider: "microsoft_teams",
      detail: "set COMMUNICATION_PROVIDER=slack for now",
    });
  }
}

module.exports = {
  MicrosoftTeamsCommunicationPlatform,
};
