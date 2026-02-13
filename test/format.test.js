const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatStatusResponse,
  formatTimestampAsUtcLegacy,
  formatTimestampWithTimezone,
} = require("../src/util/format");

test("formatStatusResponse returns no-blockers message", () => {
  const message = formatStatusResponse({
    lastDeployAt: "1970-01-01T00:00:00.000Z",
    blockers: [],
  });

  assert.equal(message, "No blockers since last prod deploy (on December 31st, 1969 at 7:00 PM EST).");
});

test("formatStatusResponse returns blocker lines with and without title", () => {
  const message = formatStatusResponse({
    lastDeployAt: new Date("2026-02-13T17:00:00.000Z"),
    blockers: [
      {
        repo: "croft-eng/croft",
        pr_number: 11,
        status: "untested",
        title: "Add deploy gate",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        status: "untested",
        title: null,
      },
    ],
  });

  assert.match(message, /Blocking PRs since last prod deploy \(on February 13th, 2026 at 12:00 PM EST\):/);
  assert.match(message, /• croft-eng\/croft#11 \(untested\) - Add deploy gate/);
  assert.match(message, /• croft-eng\/croft#12 \(untested\)/);
});

test("formatStatusResponse falls back to string when timestamp cannot be parsed", () => {
  const message = formatStatusResponse({
    lastDeployAt: "not-a-date",
    blockers: [],
  });

  assert.equal(message, "No blockers since last prod deploy (not-a-date).");
});

test("formatStatusResponse supports long time format", () => {
  const message = formatStatusResponse({
    lastDeployAt: "2026-02-13T22:00:17.000Z",
    blockers: [],
    timeFormat: "long",
  });

  assert.equal(message, "No blockers since last prod deploy (2026-02-13 22:00:17 UTC).");
});

test("formatTimestampWithTimezone supports human style with on/at phrasing", () => {
  const message = formatTimestampWithTimezone("2026-02-13T22:00:17.000Z");

  assert.equal(message, "on February 13th, 2026 at 5:00 PM EST");
});

test("formatTimestampAsUtcLegacy keeps prior UTC timestamp style", () => {
  const message = formatTimestampAsUtcLegacy("2026-02-13T22:00:17.000Z");

  assert.equal(message, "2026-02-13 22:00:17 UTC");
});
