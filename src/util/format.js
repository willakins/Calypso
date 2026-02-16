function formatStatusResponse({ lastDeployAt, blockers, timeFormat, timeZone }) {
  const lastDeploymentTimestamp = formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone });
  const hasBlockingPullRequests = Array.isArray(blockers) && blockers.length > 0;

  if (!hasBlockingPullRequests) {
    return buildNoBlockersMessage(lastDeploymentTimestamp);
  }

  return buildBlockersMessage(lastDeploymentTimestamp, blockers);
}

function formatReviewRecapResponse({
  waitingPullRequests,
  recencyValue,
  recencyUnit,
  timeZone,
}) {
  const recencyLabel = formatReviewRecencyLabel(recencyValue, recencyUnit);
  const header = `*Pull Requests waiting on review in the last ${recencyLabel}*`;
  const hasWaitingPullRequests =
    Array.isArray(waitingPullRequests) && waitingPullRequests.length > 0;

  if (!hasWaitingPullRequests) {
    return [header, "• None"].join("\n");
  }

  return [
    header,
    ...waitingPullRequests.map((pullRequest) =>
      formatWaitingPullRequestLine({ pullRequest, timeZone }),
    ),
  ].join("\n");
}

function formatReviewRecencyLabel(recencyValue, recencyUnit) {
  const normalizedRecencyValue = Number(recencyValue);
  if (!Number.isInteger(normalizedRecencyValue) || normalizedRecencyValue <= 0) {
    return "week";
  }

  const normalizedRecencyUnit = String(recencyUnit || "").toLowerCase().trim();
  const unitLabelMap = {
    d: normalizedRecencyValue === 1 ? "day" : "days",
    w: normalizedRecencyValue === 1 ? "week" : "weeks",
  };
  const unitLabel = unitLabelMap[normalizedRecencyUnit] || (normalizedRecencyValue === 1 ? "week" : "weeks");
  return normalizedRecencyValue === 1 ? unitLabel : `${normalizedRecencyValue} ${unitLabel}`;
}

function formatWaitingPullRequestLine({ pullRequest, timeZone }) {
  const pullRequestTitle = pullRequest.title || "(no title)";
  const pullRequestReference = `${pullRequest.repo}#${pullRequest.pr_number}`;
  const pullRequestLink = pullRequest.url ? `<${pullRequest.url}|${pullRequestReference}>` : pullRequestReference;
  const formattedTimestamp = formatTimestampWithTimezone(pullRequest.opened_for_review_at, {
    style: TIMESTAMP_STYLES.human,
    timeZone: timeZone || "America/New_York",
  });

  return [
    `• ${pullRequestLink} - ${pullRequestTitle}`,
    `created by ${pullRequest.author_login}`,
    `opened for review ${formattedTimestamp}`,
  ].join(" | ");
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

const TIMESTAMP_STYLES = {
  human: "human",
  legacyUtc: "legacy_utc",
};

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

module.exports = {
  TIMESTAMP_STYLES,
  formatReviewRecapResponse,
  formatReviewRecencyLabel,
  formatTimestampAsUtcLegacy,
  formatTimestampByTimeFormat,
  formatTimestampWithTimezone,
  formatStatusResponse,
  isValidTimeZone,
};
