class ProviderNotImplementedError extends Error {
  constructor({ category, provider, detail }) {
    const detailSuffix = detail ? ` (${detail})` : "";
    super(`Provider '${provider}' for ${category} is not implemented${detailSuffix}.`);
    this.name = "ProviderNotImplementedError";
    this.code = "PROVIDER_NOT_IMPLEMENTED";
    this.category = category;
    this.provider = provider;
  }
}

module.exports = {
  ProviderNotImplementedError,
};
