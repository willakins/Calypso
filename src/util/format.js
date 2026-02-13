function formatStatusResponse({ lastDeployAt, blockers }) {
  const lastDeploymentTimestamp = formatAsIsoTimestamp(lastDeployAt);
  const hasBlockingPullRequests = Array.isArray(blockers) && blockers.length > 0;

  if (!hasBlockingPullRequests) {
    return buildNoBlockersMessage(lastDeploymentTimestamp);
  }

  return buildBlockersMessage(lastDeploymentTimestamp, blockers);
}

function buildNoBlockersMessage(lastDeploymentTimestamp) {
  return `No blockers since last prod deploy (${lastDeploymentTimestamp}).`;
}

function buildBlockersMessage(lastDeploymentTimestamp, blockers) {
  return [
    `Blocking PRs since last prod deploy (${lastDeploymentTimestamp}):`,
    ...blockers.map(formatBlockingPullRequestLine),
  ].join("\n");
}

function formatBlockingPullRequestLine(pullRequest) {
  const pullRequestTitleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return `• ${pullRequest.repo}#${pullRequest.pr_number} (${pullRequest.status})${pullRequestTitleSuffix}`;
}

function formatAsIsoTimestamp(value) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }
  return parsedDate.toISOString();
}

module.exports = {
  formatStatusResponse,
};
