const { DEFAULT_EMAIL_PROVIDER, EMAIL_PROVIDERS } = require("../../config");
const { GmailEmailPlatform } = require("./providers/gmail/email_platform");
const { OutlookEmailPlatform } = require("./providers/outlook/email_platform");

const EMAIL_PLATFORM_BUILDERS = Object.freeze({
  [EMAIL_PROVIDERS.gmail]: ({ config }) => new GmailEmailPlatform({ config }),
  [EMAIL_PROVIDERS.outlook]: ({ config }) => new OutlookEmailPlatform({ config }),
});

function createEmailPlatform(options = {}) {
  const provider = options.provider || DEFAULT_EMAIL_PROVIDER;
  const buildPlatform = EMAIL_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported email provider: ${provider}`);
  }

  const platform = buildPlatform({ config: options.config || {} });
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createEmailPlatform,
};
