function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

function formatBlockingPr(pr) {
  const title = pr.title ? ` - ${pr.title}` : "";
  return `• ${pr.repo}#${pr.pr_number} (${pr.status})${title}`;
}

function formatStatusResponse({ lastDeployAt, blockers }) {
  const deployedAt = toIsoString(lastDeployAt);

  if (!blockers || blockers.length === 0) {
    return `No blockers since last prod deploy (${deployedAt}).`;
  }

  return [
    `Blocking PRs since last prod deploy (${deployedAt}):`,
    ...blockers.map(formatBlockingPr),
  ].join("\n");
}

module.exports = {
  formatStatusResponse,
};
