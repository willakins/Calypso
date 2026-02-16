const {
  markStaleOpenPullRequestsClosed,
  upsertOpenPullRequestReviewState,
} = require("../db");

function startOpenPullRequestSyncScheduler(options) {
  const {
    githubClient,
    logger = console,
    mainBranch,
    markStaleOpenPullRequestsClosedFn = markStaleOpenPullRequestsClosed,
    nowFn = () => new Date(),
    pool,
    repositoryFullName,
    syncIntervalMs,
    upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
  } = options;

  if (!pool || !githubClient || !repositoryFullName || !mainBranch || !isValidIntervalMs(syncIntervalMs)) {
    logger.warn(
      "Open PR sync scheduler disabled: missing dependencies or invalid sync interval.",
    );
    return {
      stop() {},
    };
  }

  async function tick() {
    await runOpenPullRequestSyncTick({
      githubClient,
      logger,
      mainBranch,
      markStaleOpenPullRequestsClosedFn,
      nowFn,
      pool,
      repositoryFullName,
      upsertOpenPullRequestReviewStateFn,
    });
  }

  void tick();
  const intervalId = setInterval(() => {
    void tick();
  }, syncIntervalMs);

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}

async function runOpenPullRequestSyncTick({
  githubClient,
  logger,
  mainBranch,
  markStaleOpenPullRequestsClosedFn = markStaleOpenPullRequestsClosed,
  nowFn,
  pool,
  repositoryFullName,
  swallowErrors = true,
  upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
}) {
  try {
    const openPullRequests = await githubClient.listOpenPullRequests({
      repositoryFullName,
      baseBranch: mainBranch,
    });

    const syncedAt = nowFn().toISOString();
    const openPrNumbers = [];
    let upsertedCount = 0;
    for (const pullRequest of openPullRequests) {
      const mappedState = await mapOpenPullRequestToReviewState({
        githubClient,
        mainBranch,
        pullRequest,
        repositoryFullName,
      });
      if (!mappedState) {
        continue;
      }

      await upsertOpenPullRequestReviewStateFn(pool, mappedState);
      openPrNumbers.push(mappedState.prNumber);
      upsertedCount += 1;
    }

    const closedCount = await markStaleOpenPullRequestsClosedFn(pool, {
      repo: repositoryFullName,
      baseBranch: mainBranch,
      openPrNumbers,
      closedAt: syncedAt,
    });

    logger.info(
      `Open PR sync completed: ${upsertedCount} open PR(s) upserted, ${closedCount} stale PR(s) marked closed.`,
    );
    return {
      closedCount,
      openPullRequestCount: openPullRequests.length,
      upsertedCount,
    };
  } catch (error) {
    logger.error("Open PR sync scheduler tick failed.");
    logger.error(error.message);
    if (!swallowErrors) {
      throw error;
    }
    return null;
  }
}

async function mapOpenPullRequestToReviewState({
  githubClient,
  mainBranch,
  pullRequest,
  repositoryFullName,
}) {
  const prNumber = Number(pullRequest?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  const baseBranch = String(pullRequest?.base?.ref || "");
  if (baseBranch !== mainBranch) {
    return null;
  }

  const isDraft = Boolean(pullRequest?.draft);
  const openedAt = pullRequest?.created_at || pullRequest?.updated_at || new Date().toISOString();
  const reviews = await githubClient.listPullRequestReviews({
    repositoryFullName,
    prNumber,
  });

  return {
    repo: repositoryFullName,
    prNumber,
    title: pullRequest?.title || null,
    url: pullRequest?.html_url || null,
    authorLogin: pullRequest?.user?.login || "unknown",
    baseBranch,
    isDraft,
    lifecycleState: "open",
    reviewState: isDraft ? "waiting" : deriveReviewStateFromReviews(reviews),
    openedAt,
    openedForReviewAt: isDraft ? null : openedAt,
    closedAt: null,
    mergedAt: null,
    lastReviewedAt: extractLatestReviewTimestamp(reviews),
  };
}

function deriveReviewStateFromReviews(reviews) {
  const sortedReviews = [...(Array.isArray(reviews) ? reviews : [])].sort(
    (left, right) => readReviewTimestamp(left) - readReviewTimestamp(right),
  );

  let reviewState = "waiting";
  for (const review of sortedReviews) {
    const mappedState = mapGithubReviewState(review?.state);
    if (mappedState !== undefined) {
      reviewState = mappedState;
    }
  }

  return reviewState;
}

function mapGithubReviewState(rawState) {
  const normalizedState = String(rawState || "").toLowerCase().trim();
  if (normalizedState === "approved") {
    return "approved";
  }
  if (normalizedState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedState === "dismissed") {
    return "waiting";
  }
  if (normalizedState === "commented") {
    return undefined;
  }
  return undefined;
}

function extractLatestReviewTimestamp(reviews) {
  const validReviews = Array.isArray(reviews) ? reviews : [];
  let latestTimestamp = null;
  let latestValue = Number.NEGATIVE_INFINITY;
  for (const review of validReviews) {
    const timestamp = readReviewTimestamp(review);
    if (Number.isFinite(timestamp) && timestamp > latestValue) {
      latestValue = timestamp;
      latestTimestamp = readReviewTimestampIso(review);
    }
  }

  return latestTimestamp;
}

function readReviewTimestamp(review) {
  const isoTimestamp = readReviewTimestampIso(review);
  const parsedTimestamp = Date.parse(isoTimestamp || "");
  return Number.isNaN(parsedTimestamp) ? Number.NEGATIVE_INFINITY : parsedTimestamp;
}

function readReviewTimestampIso(review) {
  return review?.submitted_at || review?.updated_at || review?.created_at || null;
}

function isValidIntervalMs(syncIntervalMs) {
  return Number.isInteger(syncIntervalMs) && syncIntervalMs > 0;
}

module.exports = {
  deriveReviewStateFromReviews,
  runOpenPullRequestSyncTick,
  startOpenPullRequestSyncScheduler,
};
