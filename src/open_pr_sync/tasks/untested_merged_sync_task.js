const { getLastProdDeployAt, upsertPullRequestAsUntestedFromSync } = require("../../db");

const UNTESTED_SYNC_TASK_NAME = "untestedSync";

function createUntestedMergedSyncTask(options = {}) {
  const getLastProdDeployAtFn = options.getLastProdDeployAtFn || getLastProdDeployAt;
  const upsertPullRequestAsUntestedFromSyncFn =
    options.upsertPullRequestAsUntestedFromSyncFn || upsertPullRequestAsUntestedFromSync;

  return {
    name: UNTESTED_SYNC_TASK_NAME,
    async run(syncContext) {
      const { githubClient, mainBranch, pool, repositoryFullName } = syncContext;
      if (typeof githubClient.listClosedPullRequests !== "function") {
        return buildEmptyUntestedSyncResult();
      }

      const lastProdDeployAt = await getLastProdDeployAtFn(pool);
      const closedPullRequests = await githubClient.listClosedPullRequests({
        repositoryFullName,
        baseBranch: mainBranch,
      });

      const mergedPullRequests = closedPullRequests.filter((pullRequest) =>
        shouldSyncMergedPullRequest({ lastProdDeployAt, mainBranch, pullRequest }),
      );

      let upsertedCount = 0;
      for (const pullRequest of mergedPullRequests) {
        const mergedPullRequestRecord = mapPullRequestToMergedUntestedRecord({
          pullRequest,
          repositoryFullName,
        });
        if (!mergedPullRequestRecord) {
          continue;
        }

        await upsertPullRequestAsUntestedFromSyncFn(pool, mergedPullRequestRecord);
        upsertedCount += 1;
      }

      return {
        mergedPullRequestCount: mergedPullRequests.length,
        upsertedCount,
      };
    },
  };
}

function shouldSyncMergedPullRequest({ lastProdDeployAt, mainBranch, pullRequest }) {
  const isMerged = Boolean(pullRequest?.merged_at);
  const isMainBranch = String(pullRequest?.base?.ref || "") === mainBranch;
  if (!isMerged || !isMainBranch) {
    return false;
  }

  const mergedTimestamp = Date.parse(String(pullRequest.merged_at));
  const lastProdDeployTimestamp = Date.parse(String(lastProdDeployAt || ""));
  if (Number.isNaN(mergedTimestamp) || Number.isNaN(lastProdDeployTimestamp)) {
    return false;
  }

  return mergedTimestamp > lastProdDeployTimestamp;
}

function mapPullRequestToMergedUntestedRecord({ pullRequest, repositoryFullName }) {
  const prNumber = Number(pullRequest?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  if (!pullRequest?.merged_at) {
    return null;
  }

  return {
    repo: repositoryFullName,
    prNumber,
    title: pullRequest?.title || null,
    url: pullRequest?.html_url || null,
    mergedAt: pullRequest.merged_at,
  };
}

function buildEmptyUntestedSyncResult() {
  return {
    mergedPullRequestCount: 0,
    upsertedCount: 0,
  };
}

module.exports = {
  buildEmptyUntestedSyncResult,
  createUntestedMergedSyncTask,
  UNTESTED_SYNC_TASK_NAME,
};
