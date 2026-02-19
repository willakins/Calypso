const {
  listTrackedOpenPullRequestsForCodexApproval,
  updatePullRequestCodexApproval,
} = require("../db");

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function startCodexApprovalSyncScheduler(options) {
  const {
    codeHostClient,
    listTrackedOpenPullRequestsForCodexApprovalFn = listTrackedOpenPullRequestsForCodexApproval,
    logger = console,
    mainBranch,
    pool,
    repository,
    syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS,
    updatePullRequestCodexApprovalFn = updatePullRequestCodexApproval,
  } = options;

  if (
    !pool ||
    !repository ||
    !mainBranch ||
    !codeHostClient ||
    typeof codeHostClient.isPullRequestCodexApproved !== "function" ||
    !isValidIntervalMs(syncIntervalMs)
  ) {
    logger.warn(
      "Codex approval sync scheduler disabled: missing dependencies or invalid sync interval.",
    );
    return {
      stop() {},
    };
  }

  async function tick() {
    await runCodexApprovalSyncTick({
      codeHostClient,
      listTrackedOpenPullRequestsForCodexApprovalFn,
      logger,
      mainBranch,
      pool,
      repository,
      updatePullRequestCodexApprovalFn,
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

async function runCodexApprovalSyncTick({
  codeHostClient,
  listTrackedOpenPullRequestsForCodexApprovalFn = listTrackedOpenPullRequestsForCodexApproval,
  logger = console,
  mainBranch,
  pool,
  repository,
  swallowErrors = true,
  updatePullRequestCodexApprovalFn = updatePullRequestCodexApproval,
}) {
  try {
    const trackedPullRequests = await listTrackedOpenPullRequestsForCodexApprovalFn(pool, {
      repo: repository,
      baseBranch: mainBranch,
    });

    let checkedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let loggedPermissionError = false;

    for (const pullRequest of trackedPullRequests) {
      const prNumber = Number(pullRequest.pr_number);
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        continue;
      }

      checkedCount += 1;
      try {
        const codexApproved = await codeHostClient.isPullRequestCodexApproved({
          repositoryFullName: repository,
          prNumber,
        });
        const currentCodexApproved = Boolean(pullRequest.codex_approved);
        if (currentCodexApproved === codexApproved) {
          continue;
        }

        const updatedRecord = await updatePullRequestCodexApprovalFn(pool, {
          repo: repository,
          prNumber,
          codexApproved,
        });
        if (updatedRecord) {
          updatedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        if (isCodexApprovalPermissionError(error)) {
          if (!loggedPermissionError) {
            logger.error(
              [
                "Codex approval sync cannot read PR reactions: CODE_HOST_TOKEN is missing required GitHub permissions.",
                "Grant at least Issues (read) on the repository and retry.",
              ].join(" "),
            );
            loggedPermissionError = true;
          }
          break;
        }
        logger.error(
          `Codex approval sync failed for ${repository}#${prNumber}: ${error.message}`,
        );
      }
    }

    logger.info(
      [
        "Codex approval sync completed:",
        `${checkedCount} PR(s) checked,`,
        `${updatedCount} PR(s) updated,`,
        `${failedCount} PR(s) failed.`,
      ].join(" "),
    );

    return {
      checkedCount,
      failedCount,
      updatedCount,
    };
  } catch (error) {
    logger.error("Codex approval sync scheduler tick failed.");
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

function isCodexApprovalPermissionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("(403)") &&
    message.includes("resource not accessible by personal access token")
  );
}

module.exports = {
  runCodexApprovalSyncTick,
  startCodexApprovalSyncScheduler,
};
