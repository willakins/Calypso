function assertNonEmptyString(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

function assertPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function splitRepositoryFullName(repositoryFullName) {
  const normalizedRepositoryFullName = String(repositoryFullName || "").trim();
  const repositoryParts = normalizedRepositoryFullName.split("/");
  if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) {
    throw new Error(`Invalid repository full name: ${repositoryFullName}`);
  }

  return {
    owner: repositoryParts[0],
    name: repositoryParts[1],
  };
}

function buildRequestUrl({ apiBaseUrl, endpointPath, queryParameters = {} }) {
  const normalizedEndpointPath = String(endpointPath || "").replace(/^\/+/, "");
  const requestUrl = new URL(normalizedEndpointPath, ensureTrailingSlash(apiBaseUrl));

  for (const [key, value] of Object.entries(queryParameters)) {
    if (value !== undefined && value !== null && value !== "") {
      requestUrl.searchParams.set(key, String(value));
    }
  }

  return requestUrl.toString();
}

async function throwIfRequestFailed({ providerName, response, requestUrl }) {
  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(
    `${providerName} API request failed (${response.status}) for ${requestUrl}: ${responseBody}`,
  );
}

function ensureTrailingSlash(value) {
  const normalizedValue = String(value || "");
  return normalizedValue.endsWith("/") ? normalizedValue : `${normalizedValue}/`;
}

module.exports = {
  assertNonEmptyString,
  assertPositiveInteger,
  buildRequestUrl,
  splitRepositoryFullName,
  throwIfRequestFailed,
};
