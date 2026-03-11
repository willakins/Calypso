const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatReviewListHeader,
  formatReviewListItem,
  formatReviewRecapResponse,
  formatReviewRecencyLabel,
  formatStatusResponse,
  formatTimestampAsUtcLegacy,
  formatTimestampWithTimezone,
  isValidTimeZone,
} = require("../../src/util/format");

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
        url: "https://github.com/croft-eng/croft/pull/11",
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
  assert.match(
    message,
    /• <https:\/\/github.com\/croft-eng\/croft\/pull\/11\|croft-eng\/croft#11> \(untested\) - Add deploy gate/,
  );
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

test("formatStatusResponse supports custom timezone for human format", () => {
  const message = formatStatusResponse({
    lastDeployAt: "2026-02-13T22:00:17.000Z",
    blockers: [],
    timeFormat: "human",
    timeZone: "America/Los_Angeles",
  });

  assert.equal(message, "No blockers since last prod deploy (on February 13th, 2026 at 2:00 PM PST).");
});

test("formatTimestampWithTimezone supports human style with on/at phrasing", () => {
  const message = formatTimestampWithTimezone("2026-02-13T22:00:17.000Z");

  assert.equal(message, "on February 13th, 2026 at 5:00 PM EST");
});

test("formatTimestampAsUtcLegacy keeps prior UTC timestamp style", () => {
  const message = formatTimestampAsUtcLegacy("2026-02-13T22:00:17.000Z");

  assert.equal(message, "2026-02-13 22:00:17 UTC");
});

test("isValidTimeZone returns true for valid IANA timezone", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
});

test("isValidTimeZone returns false for invalid timezone", () => {
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
});

test("formatReviewRecencyLabel formats compact recency values", () => {
  assert.equal(formatReviewRecencyLabel(1, "w"), "week");
  assert.equal(formatReviewRecencyLabel(2, "w"), "2 weeks");
  assert.equal(formatReviewRecencyLabel(1, "d"), "day");
  assert.equal(formatReviewRecencyLabel(3, "d"), "3 days");
});

test("formatReviewListHeader appends colon once", () => {
  assert.equal(formatReviewListHeader("Open PRs waiting on review"), "Open PRs waiting on review:");
  assert.equal(formatReviewListHeader("PRs tested in the last week:"), "PRs tested in the last week:");
});

test("formatReviewListItem renders summary and optional detail lines", () => {
  assert.equal(formatReviewListItem("croft-eng/croft#11"), "• croft-eng/croft#11");
  assert.equal(
    formatReviewListItem("croft-eng/croft#11", "author: octocat"),
    "• croft-eng/croft#11\n  author: octocat",
  );
});

test("formatReviewRecapResponse renders prioritized recap sections", () => {
  const message = formatReviewRecapResponse({
    pullRequests: [
      {
        repo: "croft-eng/croft",
        pr_number: 71,
        title: "Improve metrics",
        url: "https://github.com/croft-eng/croft/pull/71",
        author_login: "octocat",
        is_draft: false,
        review_state: "approved",
        codex_approved: false,
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 72,
        title: null,
        url: null,
        author_login: "hubot",
        is_draft: false,
        review_state: "waiting",
        codex_approved: true,
        opened_for_review_at: "2026-02-14T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 73,
        title: "Fix flaky test",
        url: null,
        author_login: "will",
        is_draft: false,
        review_state: "changes_requested",
        codex_approved: false,
        opened_for_review_at: "2026-02-15T12:00:00.000Z",
      },
    ],
    reviewScope: "week",
    timeZone: "America/New_York",
  });

  assert.match(message, /^\*PR Review Recap — last week\*/);
  assert.match(message, /\*Approved By Reviewers \(Unmerged\)\*/);
  assert.match(message, /\*Codex Approved, Waiting On Human Approval\*/);
  assert.match(message, /\*Other Open Pull Requests\*/);
  assert.match(
    message,
    /• <https:\/\/github.com\/croft-eng\/croft\/pull\/71\|#71> - \*Improve metrics\*\n  author: octocat \| review: approved \| codex: not approved \| Last modified: 2\/13\/2026/,
  );
  assert.match(
    message,
    /• #72 - \*\(no title\)\*\n  author: hubot \| review: waiting \| codex: approved \| Last modified: 2\/14\/2026/,
  );
  assert.match(
    message,
    /• #73 - \*Fix flaky test\*\n  author: will \| review: changes requested \| codex: not approved \| Last modified: 2\/15\/2026/,
  );
});

test("formatReviewRecapResponse sorts each section by most recent first", () => {
  const message = formatReviewRecapResponse({
    pullRequests: [
      {
        repo: "croft-eng/croft",
        pr_number: 11,
        title: "Older approved",
        url: "https://github.com/croft-eng/croft/pull/11",
        author_login: "octocat",
        is_draft: false,
        review_state: "approved",
        codex_approved: false,
        opened_for_review_at: "2026-02-10T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Newer approved",
        url: "https://github.com/croft-eng/croft/pull/12",
        author_login: "octocat",
        is_draft: false,
        review_state: "approved",
        codex_approved: false,
        opened_for_review_at: "2026-02-12T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 21,
        title: "Older codex",
        url: "https://github.com/croft-eng/croft/pull/21",
        author_login: "hubot",
        is_draft: false,
        review_state: "waiting",
        codex_approved: true,
        opened_for_review_at: "2026-02-11T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 22,
        title: "Newer codex",
        url: "https://github.com/croft-eng/croft/pull/22",
        author_login: "hubot",
        is_draft: false,
        review_state: "waiting",
        codex_approved: true,
        opened_for_review_at: "2026-02-14T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 31,
        title: "Older other",
        url: "https://github.com/croft-eng/croft/pull/31",
        author_login: "will",
        is_draft: false,
        review_state: "changes_requested",
        codex_approved: false,
        opened_for_review_at: "2026-02-09T12:00:00.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 32,
        title: "Newer other",
        url: "https://github.com/croft-eng/croft/pull/32",
        author_login: "will",
        is_draft: false,
        review_state: "waiting",
        codex_approved: false,
        opened_for_review_at: "2026-02-15T12:00:00.000Z",
      },
    ],
    reviewScope: "all",
    timeZone: "America/New_York",
  });

  const approvedNewerIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/12|#12>");
  const approvedOlderIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/11|#11>");
  assert.ok(approvedNewerIndex >= 0);
  assert.ok(approvedOlderIndex >= 0);
  assert.ok(approvedNewerIndex < approvedOlderIndex);

  const codexNewerIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/22|#22>");
  const codexOlderIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/21|#21>");
  assert.ok(codexNewerIndex >= 0);
  assert.ok(codexOlderIndex >= 0);
  assert.ok(codexNewerIndex < codexOlderIndex);

  const otherNewerIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/32|#32>");
  const otherOlderIndex = message.indexOf("<https://github.com/croft-eng/croft/pull/31|#31>");
  assert.ok(otherNewerIndex >= 0);
  assert.ok(otherOlderIndex >= 0);
  assert.ok(otherNewerIndex < otherOlderIndex);
});

test("formatReviewRecapResponse omits approved section when no approved PR exists", () => {
  const message = formatReviewRecapResponse({
    pullRequests: [
      {
        repo: "croft-eng/croft",
        pr_number: 72,
        title: null,
        url: null,
        author_login: "hubot",
        is_draft: false,
        review_state: "waiting",
        codex_approved: true,
        opened_for_review_at: "2026-02-14T12:00:00.000Z",
      },
    ],
    reviewScope: "all",
    timeZone: "America/New_York",
  });

  assert.doesNotMatch(message, /\*Approved By Reviewers \(Unmerged\)\*/);
  assert.match(message, /^\*PR Review Recap — all open non-draft PRs\*/);
});

test("formatReviewRecapResponse renders explicit none row when empty", () => {
  const message = formatReviewRecapResponse({
    pullRequests: [],
    reviewScope: "day",
    timeZone: "America/New_York",
  });

  assert.equal(message, "*PR Review Recap — last day*\n• No open non-draft pull requests in scope.");
});
