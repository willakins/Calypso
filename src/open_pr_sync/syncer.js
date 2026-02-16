const {
  createReviewSyncTask,
  REVIEW_SYNC_TASK_NAME,
} = require("./tasks/review_sync_task");
const {
  createUntestedMergedSyncTask,
  UNTESTED_SYNC_TASK_NAME,
} = require("./tasks/untested_merged_sync_task");

class OpenPullRequestSyncer {
  constructor({ tasks }) {
    this.tasks = Array.isArray(tasks) ? tasks : [];
  }

  async sync(syncContext) {
    const taskResults = {};
    for (const task of this.tasks) {
      taskResults[task.name] = await task.run(syncContext);
    }

    return taskResults;
  }
}

function createDefaultOpenPullRequestSyncer(options = {}) {
  const additionalTasks = Array.isArray(options.additionalTasks) ? options.additionalTasks : [];
  return new OpenPullRequestSyncer({
    tasks: [
      createReviewSyncTask(options),
      createUntestedMergedSyncTask(options),
      ...additionalTasks,
    ],
  });
}

module.exports = {
  createDefaultOpenPullRequestSyncer,
  createReviewSyncTask,
  createUntestedMergedSyncTask,
  OpenPullRequestSyncer,
  REVIEW_SYNC_TASK_NAME,
  UNTESTED_SYNC_TASK_NAME,
};
