const {
  getLastProdDeployAt,
  markStaleOpenPullRequestsClosed,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntestedFromSync,
} = require("../db");
const {
  createDefaultOpenPullRequestSyncer,
  REVIEW_SYNC_TASK_NAME,
  UNTESTED_SYNC_TASK_NAME,
} = require("./syncer");
const {
  buildEmptyReviewSyncResult,
  deriveReviewStateFromReviews,
} = require("./tasks/review_sync_task");
const { buildEmptyUntestedSyncResult } = require("./tasks/untested_merged_sync_task");

function startOpenPullRequestSyncScheduler(options) {
  const {
    codeHostClient,
    getLastProdDeployAtFn = getLastProdDeployAt,
    logger = console,
    mainBranch,
    markStaleOpenPullRequestsClosedFn = markStaleOpenPullRequestsClosed,
    nowFn = () => new Date(),
    pool,
    repository,
    syncIntervalMs,
    upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
    upsertPullRequestAsUntestedFromSyncFn = upsertPullRequestAsUntestedFromSync,
  } = options;

  if (!pool || !codeHostClient || !repository || !mainBranch || !isValidIntervalMs(syncIntervalMs)) {
    logger.warn(
      "Open PR sync scheduler disabled: missing dependencies or invalid sync interval.",
    );
    return {
      stop() {},
    };
  }

  async function tick() {
    await runOpenPullRequestSyncTick({
      codeHostClient,
      getLastProdDeployAtFn,
      logger,
      mainBranch,
      markStaleOpenPullRequestsClosedFn,
      nowFn,
      pool,
      repository,
      upsertOpenPullRequestReviewStateFn,
      upsertPullRequestAsUntestedFromSyncFn,
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
  codeHostClient,
  getLastProdDeployAtFn = getLastProdDeployAt,
  logger,
  mainBranch,
  markStaleOpenPullRequestsClosedFn = markStaleOpenPullRequestsClosed,
  nowFn = () => new Date(),
  pool,
  repository,
  swallowErrors = true,
  upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntestedFromSyncFn = upsertPullRequestAsUntestedFromSync,
}) {
  try {
    const syncer = createDefaultOpenPullRequestSyncer({
      getLastProdDeployAtFn,
      markStaleOpenPullRequestsClosedFn,
      upsertOpenPullRequestReviewStateFn,
      upsertPullRequestAsUntestedFromSyncFn,
    });

    const syncSummary = await syncer.sync({
      codeHostClient,
      mainBranch,
      nowFn,
      pool,
      repository,
    });
    const reviewSync = syncSummary[REVIEW_SYNC_TASK_NAME] || buildEmptyReviewSyncResult();
    const untestedSync = syncSummary[UNTESTED_SYNC_TASK_NAME] || buildEmptyUntestedSyncResult();
    const normalizedSummary = {
      reviewSync,
      untestedSync,
      upsertedCount: reviewSync.upsertedCount,
      closedCount: reviewSync.closedCount,
      mergedUntestedCount: untestedSync.upsertedCount,
    };

    logger.info(
      [
        "Open PR sync completed:",
        `${normalizedSummary.upsertedCount} open review PR(s) upserted,`,
        `${normalizedSummary.closedCount} stale open review PR(s) marked closed,`,
        `${normalizedSummary.mergedUntestedCount} merged untested PR(s) upserted.`,
      ].join(" "),
    );
    return normalizedSummary;
  } catch (error) {
    logger.error("Open PR sync scheduler tick failed.");
    logger.error(error.message);
    if (!swallowErrors) {
      throw error;
    }
    return null;
  }
}

function isValidIntervalMs(syncIntervalMs) {
  return Number.isInteger(syncIntervalMs) && syncIntervalMs > 0;
}

module.exports = {
  deriveReviewStateFromReviews,
  runOpenPullRequestSyncTick,
  startOpenPullRequestSyncScheduler,
};
