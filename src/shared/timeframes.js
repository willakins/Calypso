const TIMEFRAME_DEFINITIONS = Object.freeze({
  day: Object.freeze({
    displayName: "day",
    windowMs: 24 * 60 * 60 * 1000,
  }),
  week: Object.freeze({
    displayName: "week",
    windowMs: 7 * 24 * 60 * 60 * 1000,
  }),
  month: Object.freeze({
    displayName: "month",
    windowMs: 30 * 24 * 60 * 60 * 1000,
  }),
});

const REVIEW_RECENCY_UNITS = Object.freeze({
  day: "d",
  week: "w",
});

function isValidTimeframe(timeframe) {
  const normalizedTimeframe = String(timeframe || "").toLowerCase().trim();
  return Boolean(TIMEFRAME_DEFINITIONS[normalizedTimeframe]);
}

function timeframeSince(timeframe, now = Date.now()) {
  const normalizedTimeframe = String(timeframe || "").toLowerCase().trim();
  const timeframeDefinition = TIMEFRAME_DEFINITIONS[normalizedTimeframe];
  if (!timeframeDefinition) {
    return null;
  }

  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowTimestamp)) {
    return null;
  }

  return new Date(nowTimestamp - timeframeDefinition.windowMs);
}

function formatReviewRecencyLabel(recencyValue, recencyUnit) {
  const normalizedRecencyValue = Number(recencyValue);
  if (!Number.isInteger(normalizedRecencyValue) || normalizedRecencyValue <= 0) {
    return "week";
  }

  const normalizedRecencyUnit = String(recencyUnit || "").toLowerCase().trim();
  const unitLabelMap = {
    [REVIEW_RECENCY_UNITS.day]: normalizedRecencyValue === 1 ? "day" : "days",
    [REVIEW_RECENCY_UNITS.week]: normalizedRecencyValue === 1 ? "week" : "weeks",
  };
  const unitLabel = unitLabelMap[normalizedRecencyUnit] ||
    (normalizedRecencyValue === 1 ? "week" : "weeks");
  return normalizedRecencyValue === 1 ? unitLabel : `${normalizedRecencyValue} ${unitLabel}`;
}

module.exports = {
  TIMEFRAME_DEFINITIONS,
  REVIEW_RECENCY_UNITS,
  formatReviewRecencyLabel,
  isValidTimeframe,
  timeframeSince,
};
