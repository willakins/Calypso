const assert = require("node:assert/strict");
const test = require("node:test");

const { formatStatusResponse } = require("../src/util/format");

test("formatStatusResponse returns no-blockers message", () => {
  const message = formatStatusResponse({
    lastDeployAt: "1970-01-01T00:00:00.000Z",
    blockers: [],
  });

  assert.equal(message, "No blockers since last prod deploy (1970-01-01T00:00:00.000Z).");
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

  assert.match(message, /Blocking PRs since last prod deploy \(2026-02-13T17:00:00.000Z\):/);
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
