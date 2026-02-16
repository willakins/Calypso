const {
  assertNonEmptyString,
  assertPositiveInteger,
  buildRequestUrl,
  splitRepositoryFullName,
  throwIfRequestFailed,
} = require("../shared/client_common");

function createBitbucketClient(options) {
  const clientSettings = normalizeBitbucketClientSettings(options);

  return {
    async listOpenPullRequests({ repositoryFullName, baseBranch }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertNonEmptyString(baseBranch, "code host main branch");

      const pullRequests = await fetchAllPagesFromBitbucket({
        clientSettings,
        endpointPath: `/repositories/${repository.owner}/${repository.name}/pullrequests`,
        queryParameters: {
          state: "OPEN",
          q: `destination.branch.name="${baseBranch}"`,
        },
      });

      return pullRequests.map(normalizeBitbucketPullRequest);
    },

    async listPullRequestReviews({ repositoryFullName, prNumber }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertPositiveInteger(prNumber, "pull request number");

      const pullRequest = await fetchBitbucketResource({
        clientSettings,
        endpointPath: `/repositories/${repository.owner}/${repository.name}/pullrequests/${prNumber}`,
      });

      return mapParticipantsToReviewRecords(pullRequest?.participants);
    },

    async listClosedPullRequests({ repositoryFullName, baseBranch }) {
      const repository = splitRepositoryFullName(repositoryFullName);
      assertNonEmptyString(baseBranch, "code host main branch");

      const pullRequests = await fetchAllPagesFromBitbucket({
        clientSettings,
        endpointPath: `/repositories/${repository.owner}/${repository.name}/pullrequests`,
        queryParameters: {
          state: "MERGED",
          q: `destination.branch.name="${baseBranch}"`,
        },
      });

      return pullRequests.map(normalizeBitbucketPullRequest);
    },
  };
}

function normalizeBitbucketClientSettings(options) {
  const settings = options || {};
  assertNonEmptyString(settings.token, "CODE_HOST_TOKEN");
  assertNonEmptyString(settings.apiBaseUrl, "code host api base url");
  assertNonEmptyString(settings.apiUserAgent, "code host api user agent");
  assertPositiveInteger(settings.apiPageSize, "code host api page size");
  assertPositiveInteger(settings.apiMaxPages, "code host api max pages");

  return {
    token: settings.token,
    apiBaseUrl: settings.apiBaseUrl,
    apiUserAgent: settings.apiUserAgent,
    apiPageSize: settings.apiPageSize,
    apiMaxPages: settings.apiMaxPages,
  };
}

async function fetchAllPagesFromBitbucket({ clientSettings, endpointPath, queryParameters = {} }) {
  const combinedRecords = [];
  let requestUrl = buildRequestUrl({
    apiBaseUrl: clientSettings.apiBaseUrl,
    endpointPath,
    queryParameters: {
      ...queryParameters,
      pagelen: clientSettings.apiPageSize,
    },
  });
  let pageCount = 0;

  while (requestUrl && pageCount < clientSettings.apiMaxPages) {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: buildBitbucketRequestHeaders(clientSettings),
    });
    await throwIfRequestFailed({ providerName: "Bitbucket", response, requestUrl });

    const pagePayload = await response.json();
    const pageRecords = Array.isArray(pagePayload?.values) ? pagePayload.values : [];
    combinedRecords.push(...pageRecords);
    requestUrl = pagePayload?.next || null;
    pageCount += 1;
  }

  if (requestUrl) {
    throw new Error(
      `Bitbucket API pagination exceeded ${clientSettings.apiMaxPages} pages for ${endpointPath}`,
    );
  }

  return combinedRecords;
}

async function fetchBitbucketResource({ clientSettings, endpointPath, queryParameters = {} }) {
  const requestUrl = buildRequestUrl({
    apiBaseUrl: clientSettings.apiBaseUrl,
    endpointPath,
    queryParameters,
  });
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildBitbucketRequestHeaders(clientSettings),
  });
  await throwIfRequestFailed({ providerName: "Bitbucket", response, requestUrl });
  return response.json();
}

function buildBitbucketRequestHeaders(clientSettings) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${clientSettings.token}`,
    "User-Agent": clientSettings.apiUserAgent,
  };
}

function normalizeBitbucketPullRequest(pullRequest) {
  return {
    number: pullRequest?.id,
    title: pullRequest?.title || null,
    html_url: pullRequest?.links?.html?.href || null,
    user: {
      login: readBitbucketUserLogin(pullRequest?.author?.user),
    },
    base: {
      ref: pullRequest?.destination?.branch?.name || "",
    },
    draft: Boolean(pullRequest?.draft),
    created_at: pullRequest?.created_on || null,
    updated_at: pullRequest?.updated_on || null,
    merged_at: pullRequest?.state === "MERGED" ? pullRequest?.updated_on || null : null,
    participants: Array.isArray(pullRequest?.participants) ? pullRequest.participants : [],
  };
}

function mapParticipantsToReviewRecords(participants) {
  const normalizedParticipants = Array.isArray(participants) ? participants : [];
  return normalizedParticipants.map((participant) => ({
    state: participant?.approved ? "APPROVED" : "COMMENTED",
    submitted_at: participant?.participated_on || participant?.updated_on || null,
    user: {
      login: readBitbucketUserLogin(participant?.user),
    },
  }));
}

function readBitbucketUserLogin(user) {
  return (
    user?.nickname ||
    user?.username ||
    user?.display_name ||
    user?.account_id ||
    "unknown"
  );
}

module.exports = {
  createBitbucketClient,
};
