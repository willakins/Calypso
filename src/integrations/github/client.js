function createGithubClient(options) {
  const clientSettings = normalizeGithubClientSettings(options);

  return {
    async listOpenPullRequests({ repositoryFullName, baseBranch }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertNonEmptyString(baseBranch, "github main branch");

      return fetchAllPagesFromGithub({
        clientSettings,
        endpointPath: `/repos/${repository.owner}/${repository.name}/pulls`,
        queryParameters: {
          state: "open",
          base: baseBranch,
        },
      });
    },

    async listPullRequestReviews({ repositoryFullName, prNumber }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertPositiveInteger(prNumber, "pull request number");

      return fetchAllPagesFromGithub({
        clientSettings,
        endpointPath: `/repos/${repository.owner}/${repository.name}/pulls/${prNumber}/reviews`,
      });
    },

    async listClosedPullRequests({ repositoryFullName, baseBranch }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertNonEmptyString(baseBranch, "github main branch");

      return fetchAllPagesFromGithub({
        clientSettings,
        endpointPath: `/repos/${repository.owner}/${repository.name}/pulls`,
        queryParameters: {
          state: "closed",
          base: baseBranch,
          sort: "updated",
          direction: "desc",
        },
      });
    },
  };
}

function normalizeGithubClientSettings(options) {
  const settings = options || {};
  assertNonEmptyString(settings.token, "GITHUB_TOKEN");
  assertNonEmptyString(settings.apiBaseUrl, "github api base url");
  assertNonEmptyString(settings.apiVersion, "github api version");
  assertNonEmptyString(settings.apiUserAgent, "github api user agent");
  assertPositiveInteger(settings.apiPageSize, "github api page size");
  assertPositiveInteger(settings.apiMaxPages, "github api max pages");

  return {
    token: settings.token,
    apiBaseUrl: settings.apiBaseUrl,
    apiVersion: settings.apiVersion,
    apiUserAgent: settings.apiUserAgent,
    apiPageSize: settings.apiPageSize,
    apiMaxPages: settings.apiMaxPages,
  };
}

async function fetchAllPagesFromGithub({ clientSettings, endpointPath, queryParameters = {} }) {
  const combinedRecords = [];
  let pageNumber = 1;

  while (pageNumber <= clientSettings.apiMaxPages) {
    const requestUrl = buildGithubRequestUrl({
      apiBaseUrl: clientSettings.apiBaseUrl,
      endpointPath,
      queryParameters: {
        ...queryParameters,
        per_page: clientSettings.apiPageSize,
        page: pageNumber,
      },
    });

    const response = await fetch(requestUrl, {
      method: "GET",
      headers: buildGithubRequestHeaders(clientSettings),
    });
    await throwIfGithubRequestFailed(response, requestUrl);

    const pageRecords = await response.json();
    if (!Array.isArray(pageRecords)) {
      throw new Error(`GitHub API returned non-array payload for ${requestUrl}`);
    }

    combinedRecords.push(...pageRecords);
    if (pageRecords.length < clientSettings.apiPageSize) {
      return combinedRecords;
    }

    pageNumber += 1;
  }

  throw new Error(
    `GitHub API pagination exceeded ${clientSettings.apiMaxPages} pages for ${endpointPath}`,
  );
}

function buildGithubRequestUrl({ apiBaseUrl, endpointPath, queryParameters }) {
  const requestUrl = new URL(endpointPath, apiBaseUrl);
  for (const [key, value] of Object.entries(queryParameters)) {
    if (value !== undefined && value !== null && value !== "") {
      requestUrl.searchParams.set(key, String(value));
    }
  }
  return requestUrl.toString();
}

function buildGithubRequestHeaders(clientSettings) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${clientSettings.token}`,
    "X-GitHub-Api-Version": clientSettings.apiVersion,
    "User-Agent": clientSettings.apiUserAgent,
  };
}

async function throwIfGithubRequestFailed(response, requestUrl) {
  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(
    `GitHub API request failed (${response.status}) for ${requestUrl}: ${responseBody}`,
  );
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

module.exports = {
  createGithubClient,
};
