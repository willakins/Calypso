const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findMostRecentScheduledSlot,
  runReviewRecapSchedulerTick,
} = require("../../src/background_jobs/review_recap_scheduler");

test("findMostRecentScheduledSlot resolves monday 9am America/New_York slot", () => {
  const slot = findMostRecentScheduledSlot({
    now: new Date("2026-02-16T14:05:00.000Z"),
    scheduleWeekday: "mon",
    scheduleTime: "09:00",
    timeZone: "America/New_York",
    lookbackMinutes: 60,
  });

  assert.ok(slot);
  assert.equal(slot.toISOString(), "2026-02-16T14:00:00.000Z");
});

test("runReviewRecapSchedulerTick posts and marks slot when due", async () => {
  const calls = {
    list: [],
    mark: [],
    post: [],
  };
  const now = new Date("2026-02-16T14:05:00.000Z");

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async (_pool, sinceTimestamp) => {
      calls.list.push(sinceTimestamp);
      return [
        {
          repo: "croft-eng/croft",
          pr_number: 71,
          title: "Improve metrics",
          url: "https://github.com/croft-eng/croft/pull/71",
          author_login: "octocat",
          opened_for_review_at: "2026-02-13T22:00:17.000Z",
        },
      ];
    },
    markReviewRecapSentFn: async (_pool, slotTimestamp) => {
      calls.mark.push(slotTimestamp);
      return { id: 1, last_sent_slot_at: slotTimestamp };
    },
    formatReviewRecapResponseFn: ({ waitingPullRequests }) => {
      assert.equal(waitingPullRequests.length, 1);
      return "recap message";
    },
    nowFn: () => now,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
    slackClient: {
      chat: {
        async postMessage(message) {
          calls.post.push(message);
        },
      },
    },
  });

  assert.equal(calls.list.length, 1);
  assert.equal(calls.post.length, 1);
  assert.deepEqual(calls.post[0], {
    channel: "CDEPLOY",
    text: "recap message",
    mrkdwn: true,
  });
  assert.deepEqual(calls.mark, ["2026-02-16T14:00:00.000Z"]);
});

test("runReviewRecapSchedulerTick skips when slot already sent", async () => {
  let postCalled = false;
  let markCalled = false;

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: "2026-02-16T14:00:00.000Z",
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    markReviewRecapSentFn: async () => {
      markCalled = true;
    },
    formatReviewRecapResponseFn: () => "recap message",
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
    slackClient: {
      chat: {
        async postMessage() {
          postCalled = true;
        },
      },
    },
  });

  assert.equal(postCalled, false);
  assert.equal(markCalled, false);
});

test("runReviewRecapSchedulerTick logs when no channel configured", async () => {
  const infoLogs = [];

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: null,
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    markReviewRecapSentFn: async () => null,
    formatReviewRecapResponseFn: () => "unused",
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    logger: {
      info(message) {
        infoLogs.push(message);
      },
      warn() {},
      error() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
    slackClient: {
      chat: {
        async postMessage() {},
      },
    },
  });

  assert.equal(infoLogs.length, 1);
  assert.match(infoLogs[0], /no target channel configured/i);
});

test("runReviewRecapSchedulerTick stops retrying after 3 not_in_channel failures for the same slot", async () => {
  const errorLogs = [];
  let listCallCount = 0;
  let postCallCount = 0;
  const schedulerState = {
    lastNoChannelLogMinuteKey: null,
  };

  const runTick = async () =>
    runReviewRecapSchedulerTick({
      getReviewRecapConfigFn: async () => ({
        targetChannelId: "CDEPLOY",
        recencyValue: 1,
        recencyUnit: "w",
        scheduleWeekday: "mon",
        scheduleTime: "09:00",
        timeZone: "America/New_York",
        lastSentSlotAt: null,
      }),
      listOpenPullRequestsWaitingOnReviewSinceFn: async () => {
        listCallCount += 1;
        return [];
      },
      markReviewRecapSentFn: async () => {
        throw new Error("should not mark sent on failure");
      },
      formatReviewRecapResponseFn: () => "recap message",
      nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
      logger: {
        info() {},
        warn() {},
        error(message) {
          errorLogs.push(String(message));
        },
      },
      messageClient: {
        async postChannelMessage() {
          postCallCount += 1;
          const error = new Error("An API error occurred: not_in_channel");
          error.data = { error: "not_in_channel" };
          throw error;
        },
      },
      pool: {},
      schedulerState,
    });

  await runTick();
  await runTick();
  await runTick();
  await runTick();

  assert.equal(postCallCount, 3);
  assert.equal(listCallCount, 3);
  assert.equal(
    errorLogs.filter((message) => /bot is not in the configured channel/i.test(message)).length,
    3,
  );
  assert.equal(
    errorLogs.filter((message) => /max retry attempts \(3\)/i.test(message)).length,
    1,
  );
});
