const DURATION_UNITS = Object.freeze({
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
});

function parseDurationToken(rawValue) {
  const normalizedValue = String(rawValue || "").trim().toLowerCase();
  const match = normalizedValue.match(/^(\d+)([hdw])$/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isInteger(value) || value <= 0 || !DURATION_UNITS[unit]) {
    return null;
  }

  return {
    value,
    unit,
    normalizedToken: `${value}${unit}`,
    durationMs: value * DURATION_UNITS[unit],
  };
}

module.exports = {
  parseDurationToken,
};
