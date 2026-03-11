const { formatReviewRecencyLabel } = require("../shared/timeframes");

const TIMESTAMP_STYLES = {
  human: "human",
  legacyUtc: "legacy_utc",
};

const UTC_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatReviewListHeader(label) {
  const normalizedLabel = String(label || "").trim();
  if (normalizedLabel === "") {
    return ":";
  }

  return normalizedLabel.endsWith(":") ? normalizedLabel : `${normalizedLabel}:`;
}

function formatReviewListItem(summary, details = null) {
  const normalizedSummary = String(summary || "").trim();
  const headerLine = normalizedSummary === "" ? "•" : `• ${normalizedSummary}`;
  if (details === null || details === undefined) {
    return headerLine;
  }

  const detailLines = (Array.isArray(details) ? details : [details])
    .flatMap((line) => String(line || "").split("\n"))
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (detailLines.length === 0) {
    return headerLine;
  }

  return [
    headerLine,
    ...detailLines.map((line) => `  ${line}`),
  ].join("\n");
}

function formatStatusResponse({ lastDeployAt, blockers, timeFormat, timeZone }) {
  const lastDeploymentTimestamp = formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone });
  const hasBlockingPullRequests = Array.isArray(blockers) && blockers.length > 0;

  if (!hasBlockingPullRequests) {
    return buildNoBlockersMessage(lastDeploymentTimestamp);
  }

  return buildBlockersMessage(lastDeploymentTimestamp, blockers);
}

function formatReviewRecapResponse({
  pullRequests,
  waitingPullRequests,
  reviewScope,
  recencyValue,
  recencyUnit,
  timeZone,
}) {
  const effectivePullRequests = Array.isArray(pullRequests)
    ? pullRequests
    : waitingPullRequests;
  const inScopeLabel = formatReviewRecapScopeLabel({
    reviewScope,
    recencyValue,
    recencyUnit,
  });
  const header = `*PR Review Recap — ${inScopeLabel}*`;
  const hasPullRequests = Array.isArray(effectivePullRequests) && effectivePullRequests.length > 0;

  if (!hasPullRequests) {
    return [header, formatReviewListItem("No open non-draft pull requests in scope.")].join("\n");
  }

  const sections = buildReviewRecapSections(effectivePullRequests);
  return [
    header,
    ...sections.flatMap((section) => [
      "",
      `*${section.title}*`,
      ...section.pullRequests.map((pullRequest) =>
        formatReviewPullRequestLine({ pullRequest, timeZone }),
      ),
    ]),
  ].join("\n");
}

function buildReviewRecapSections(pullRequests) {
  const approvedByUsers = [];
  const codexApprovedWithoutUserApproval = [];
  const otherOpenPullRequests = [];

  for (const pullRequest of pullRequests) {
    if (isUserApprovedPullRequest(pullRequest)) {
      approvedByUsers.push(pullRequest);
      continue;
    }

    if (pullRequest?.codex_approved === true) {
      codexApprovedWithoutUserApproval.push(pullRequest);
      continue;
    }

    otherOpenPullRequests.push(pullRequest);
  }

  return [
    {
      title: "Approved By Reviewers (Unmerged)",
      pullRequests: sortPullRequestsByMostRecent(approvedByUsers),
    },
    {
      title: "Codex Approved, Waiting On Human Approval",
      pullRequests: sortPullRequestsByMostRecent(codexApprovedWithoutUserApproval),
    },
    {
      title: "Other Open Pull Requests",
      pullRequests: sortPullRequestsByMostRecent(otherOpenPullRequests),
    },
  ].filter((section) => section.pullRequests.length > 0);
}

function sortPullRequestsByMostRecent(pullRequests) {
  return [...(Array.isArray(pullRequests) ? pullRequests : [])].sort((left, right) => {
    const leftTimestamp = readComparableTimestamp(readReviewPullRequestLastModifiedAt(left));
    const rightTimestamp = readComparableTimestamp(readReviewPullRequestLastModifiedAt(right));
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    const leftPrNumber = Number(left?.pr_number);
    const rightPrNumber = Number(right?.pr_number);
    const normalizedLeftPrNumber = Number.isFinite(leftPrNumber) ? leftPrNumber : -Infinity;
    const normalizedRightPrNumber = Number.isFinite(rightPrNumber) ? rightPrNumber : -Infinity;
    return normalizedRightPrNumber - normalizedLeftPrNumber;
  });
}

function readComparableTimestamp(value) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function readReviewPullRequestLastModifiedAt(pullRequest) {
  return pullRequest?.last_modified_at
    || pullRequest?.last_reviewed_at
    || pullRequest?.opened_for_review_at
    || pullRequest?.opened_at
    || null;
}

function isUserApprovedPullRequest(pullRequest) {
  return String(pullRequest?.review_state || "").toLowerCase().trim() === "approved";
}

function formatReviewPullRequestLine({ pullRequest, timeZone }) {
  const pullRequestTitle = pullRequest.title || "(no title)";
  const pullRequestLink = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
    display: "number",
  });
  const lastModifiedAt = readReviewPullRequestLastModifiedAt(pullRequest);
  const formattedLastModified = lastModifiedAt
    ? formatDateWithTimezone(lastModifiedAt, timeZone || "America/New_York")
    : "unknown";

  return formatReviewListItem(
    `${pullRequestLink} - *${pullRequestTitle}*`,
    [
      `author: ${pullRequest.author_login || "unknown"}`,
      `review: ${formatReviewStateLabel(pullRequest.review_state)}`,
      `codex: ${pullRequest?.codex_approved === true ? "approved" : "not approved"}`,
      `Last modified: ${formattedLastModified}`,
    ].join(" | "),
  );
}

function formatReviewStateLabel(reviewState) {
  const normalizedReviewState = String(reviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes requested";
  }
  if (normalizedReviewState === "waiting") {
    return "waiting";
  }

  return "unknown";
}

function formatReviewRecapScopeLabel({ reviewScope, recencyValue, recencyUnit }) {
  const normalizedScope = String(reviewScope || "").toLowerCase().trim();
  if (normalizedScope === "day") {
    return "last day";
  }
  if (normalizedScope === "week") {
    return "last week";
  }
  if (normalizedScope === "month") {
    return "last month";
  }
  if (normalizedScope === "legacy") {
    const recencyLabel = formatReviewRecencyLabel(recencyValue, recencyUnit);
    return `last ${recencyLabel}`;
  }

  return "all open non-draft PRs";
}

function formatPullRequestReviewIndicators(pullRequest) {
  return [
    formatDraftIndicator(pullRequest?.is_draft),
    formatCodexApprovalIndicator(pullRequest),
  ].join(" | ");
}

function formatDraftIndicator(isDraft) {
  return isDraft ? "Draft: Yes" : "Draft: No";
}

function formatCodexApprovalIndicator(pullRequest) {
  const isCodexApproved = pullRequest?.codex_approved === true;
  return isCodexApproved ? "Codex Approved: Yes" : "Codex Approved: No";
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
  const pullRequestReference = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
  });
  const pullRequestTitleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return `• ${pullRequestReference} (${pullRequest.status})${pullRequestTitleSuffix}`;
}

function formatPullRequestReference({ repo, prNumber, url, display = "full" }) {
  const normalizedRepo = String(repo || "").trim();
  const normalizedPrNumber = Number.isFinite(Number(prNumber)) ? Number(prNumber) : String(prNumber || "");
  const referenceLabel =
    display === "number"
      ? `#${normalizedPrNumber}`
      : `${normalizedRepo}#${normalizedPrNumber}`;
  if (!url) {
    return referenceLabel;
  }

  return `<${url}|${referenceLabel}>`;
}

function formatTimestampWithTimezone(value, options = {}) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  const style = options.style || TIMESTAMP_STYLES.human;
  if (style === TIMESTAMP_STYLES.legacyUtc) {
    return formatTimestampAsUtcLegacyFromParsedDate(parsedDate);
  }

  const timeZone = options.timeZone || "America/New_York";
  return formatTimestampAsHumanFromParsedDate(parsedDate, timeZone);
}

function formatTimestampByTimeFormat(value, options = {}) {
  const normalizedTimeFormat = String(options.timeFormat || "").toLowerCase().trim();
  if (normalizedTimeFormat === "long") {
    return formatTimestampWithTimezone(value, {
      style: TIMESTAMP_STYLES.legacyUtc,
    });
  }

  return formatTimestampWithTimezone(value, {
    style: TIMESTAMP_STYLES.human,
    timeZone: options.timeZone || "America/New_York",
  });
}

function isValidTimeZone(timeZone) {
  const candidateTimeZone = String(timeZone || "").trim();
  if (candidateTimeZone === "") {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidateTimeZone });
    return true;
  } catch (_error) {
    return false;
  }
}

function formatTimestampAsUtcLegacy(value) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  return formatTimestampAsUtcLegacyFromParsedDate(parsedDate);
}

function formatTimestampAsHumanFromParsedDate(parsedDate, timeZone) {
  const timestampParts = readDateTimeParts(parsedDate, timeZone);
  const dayOfMonth = Number(timestampParts.day);
  const ordinalDay = `${dayOfMonth}${readOrdinalSuffix(dayOfMonth)}`;
  const meridiem = (timestampParts.dayPeriod || "").toUpperCase();

  return [
    "on",
    `${timestampParts.month} ${ordinalDay},`,
    `${timestampParts.year}`,
    "at",
    `${timestampParts.hour}:${timestampParts.minute}`,
    meridiem,
    timestampParts.timeZoneName,
  ].join(" ");
}

function formatTimestampAsUtcLegacyFromParsedDate(parsedDate) {
  const year = parsedDate.getUTCFullYear();
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getUTCDate()).padStart(2, "0");
  const hour = String(parsedDate.getUTCHours()).padStart(2, "0");
  const minute = String(parsedDate.getUTCMinutes()).padStart(2, "0");
  const second = String(parsedDate.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}

function formatDateWithTimezone(value, timeZone) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
    return formatter.format(parsedDate);
  } catch (_error) {
    return formatDateWithTimezone(parsedDate, "UTC");
  }
}

function readDateTimeParts(parsedDate, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });

    const parts = formatter.formatToParts(parsedDate);
    const partsByType = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        partsByType[part.type] = part.value;
      }
    }

    return {
      month: partsByType.month,
      day: partsByType.day,
      year: partsByType.year,
      hour: partsByType.hour,
      minute: partsByType.minute,
      dayPeriod: partsByType.dayPeriod,
      timeZoneName: partsByType.timeZoneName || "UTC",
    };
  } catch (_error) {
    if (timeZone !== "UTC") {
      return readDateTimeParts(parsedDate, "UTC");
    }

    const hour24 = parsedDate.getUTCHours();
    return {
      month: UTC_MONTH_NAMES[parsedDate.getUTCMonth()],
      day: String(parsedDate.getUTCDate()),
      year: String(parsedDate.getUTCFullYear()),
      hour: String(hour24 % 12 || 12),
      minute: String(parsedDate.getUTCMinutes()).padStart(2, "0"),
      dayPeriod: hour24 >= 12 ? "PM" : "AM",
      timeZoneName: "UTC",
    };
  }
}

function readOrdinalSuffix(dayOfMonth) {
  if (dayOfMonth % 100 >= 11 && dayOfMonth % 100 <= 13) {
    return "th";
  }

  switch (dayOfMonth % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

module.exports = {
  TIMESTAMP_STYLES,
  formatPullRequestReviewIndicators,
  sortPullRequestsByMostRecent,
  formatReviewListHeader,
  formatReviewListItem,
  formatReviewPullRequestLine,
  formatReviewRecapResponse,
  formatReviewRecencyLabel,
  formatPullRequestReference,
  formatTimestampAsUtcLegacy,
  formatTimestampByTimeFormat,
  formatTimestampWithTimezone,
  formatStatusResponse,
  isValidTimeZone,
};
