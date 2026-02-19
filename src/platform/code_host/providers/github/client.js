const {
  assertNonEmptyString,
  assertPositiveInteger,
  buildRequestUrl,
  splitRepositoryFullName,
  throwIfRequestFailed,
} = require("../shared/client_common");

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

    async isPullRequestCodexApproved({ repositoryFullName, prNumber }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertPositiveInteger(prNumber, "pull request number");

      const reactions = await fetchAllPagesFromGithub({
        clientSettings,
        endpointPath: `/repos/${repository.owner}/${repository.name}/issues/${prNumber}/reactions`,
      });

      return reactions.some((reaction) => {
        const reactionContent = String(reaction?.content || "").toLowerCase().trim();
        const reactionUserLogin = String(reaction?.user?.login || "").toLowerCase().trim();
        return reactionContent === "+1" && clientSettings.codexUserLogins.includes(reactionUserLogin);
      });
    },
  };
}

function normalizeGithubClientSettings(options) {
  const settings = options || {};
  assertNonEmptyString(settings.token, "CODE_HOST_TOKEN");
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
    codexUserLogins: normalizeCodexUserLogins(settings.codexUserLogins),
  };
}

function normalizeCodexUserLogins(rawLogins) {
  const rawValues = Array.isArray(rawLogins) ? rawLogins : [rawLogins];
  const normalizedLogins = rawValues
    .map((value) => String(value || "").toLowerCase().trim())
    .filter(Boolean);
  if (normalizedLogins.length > 0) {
    return normalizedLogins;
  }

  return ["codex", "codex[bot]"];
}

async function fetchAllPagesFromGithub({ clientSettings, endpointPath, queryParameters = {} }) {
  const combinedRecords = [];
  let pageNumber = 1;

  while (pageNumber <= clientSettings.apiMaxPages) {
    const requestUrl = buildRequestUrl({
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
    await throwIfRequestFailed({ providerName: "GitHub", response, requestUrl });

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

function buildGithubRequestHeaders(clientSettings) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${clientSettings.token}`,
    "X-GitHub-Api-Version": clientSettings.apiVersion,
    "User-Agent": clientSettings.apiUserAgent,
  };
}

module.exports = {
  createGithubClient,
};
