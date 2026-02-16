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

module.exports = {
  TIMEFRAME_DEFINITIONS,
  isValidTimeframe,
  timeframeSince,
};
