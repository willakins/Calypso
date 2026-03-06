const { DEFAULT_ERROR_TRACKING_PROVIDER, ERROR_TRACKING_PROVIDERS } = require("../../config");
const { RollbarErrorTrackingPlatform } = require("./providers/rollbar/error_tracking_platform");
const { SentryErrorTrackingPlatform } = require("./providers/sentry/error_tracking_platform");

const ERROR_TRACKING_PLATFORM_BUILDERS = Object.freeze({
  [ERROR_TRACKING_PROVIDERS.sentry]: ({ config }) => new SentryErrorTrackingPlatform({ config }),
  [ERROR_TRACKING_PROVIDERS.rollbar]: ({ config }) => new RollbarErrorTrackingPlatform({ config }),
});

function createErrorTrackingPlatform(options = {}) {
  const provider = options.provider || DEFAULT_ERROR_TRACKING_PROVIDER;
  const buildPlatform = ERROR_TRACKING_PLATFORM_BUILDERS[provider];
  if (!buildPlatform) {
    throw new Error(`Unsupported error tracking provider: ${provider}`);
  }

  const platform = buildPlatform({ config: options.config || {} });
  platform.assertAvailable();
  return platform;
}

module.exports = {
  createErrorTrackingPlatform,
};
