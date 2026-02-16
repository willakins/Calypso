const {
  getReviewRecapConfig,
  listOpenPullRequestsWaitingOnReviewSince,
  markReviewRecapSent,
} = require("../db");
const { formatReviewRecapResponse } = require("../util/format");

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const SCHEDULE_LOOKBACK_MINUTES = 8 * 24 * 60;

function startReviewRecapScheduler(options) {
  const {
    getReviewRecapConfigFn = getReviewRecapConfig,
    listOpenPullRequestsWaitingOnReviewSinceFn = listOpenPullRequestsWaitingOnReviewSince,
    markReviewRecapSentFn = markReviewRecapSent,
    formatReviewRecapResponseFn = formatReviewRecapResponse,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    nowFn = () => new Date(),
    logger = console,
    pool,
    slackClient,
  } = options;

  if (!pool || !slackClient || !slackClient.chat || typeof slackClient.chat.postMessage !== "function") {
    logger.warn("Review recap scheduler disabled: missing pool or Slack chat client.");
    return {
      stop() {},
    };
  }

  const schedulerState = {
    lastNoChannelLogMinuteKey: null,
  };

  async function tick() {
    await runReviewRecapSchedulerTick({
      getReviewRecapConfigFn,
      listOpenPullRequestsWaitingOnReviewSinceFn,
      markReviewRecapSentFn,
      formatReviewRecapResponseFn,
      nowFn,
      logger,
      pool,
      schedulerState,
      slackClient,
    });
  }

  void tick();
  const intervalId = setInterval(() => {
    void tick();
  }, tickIntervalMs);

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}

async function runReviewRecapSchedulerTick({
  getReviewRecapConfigFn,
  listOpenPullRequestsWaitingOnReviewSinceFn,
  markReviewRecapSentFn,
  formatReviewRecapResponseFn,
  nowFn,
  logger,
  pool,
  schedulerState,
  slackClient,
}) {
  try {
    const now = nowFn();
    const config = await getReviewRecapConfigFn(pool);
    if (!config.targetChannelId) {
      logNoChannelConfigured({ logger, now, schedulerState });
      return;
    }

    const scheduledSlot = findMostRecentScheduledSlot({
      now,
      scheduleWeekday: config.scheduleWeekday,
      scheduleTime: config.scheduleTime,
      timeZone: config.timeZone,
      lookbackMinutes: SCHEDULE_LOOKBACK_MINUTES,
    });
    if (!scheduledSlot) {
      return;
    }

    if (hasSlotAlreadyBeenSent({ scheduledSlot, lastSentSlotAt: config.lastSentSlotAt })) {
      return;
    }

    const sinceTimestamp = computeSinceTimestamp({
      now,
      recencyValue: config.recencyValue,
      recencyUnit: config.recencyUnit,
    });
    const waitingPullRequests = await listOpenPullRequestsWaitingOnReviewSinceFn(pool, sinceTimestamp);
    const message = formatReviewRecapResponseFn({
      waitingPullRequests,
      recencyValue: config.recencyValue,
      recencyUnit: config.recencyUnit,
      timeZone: config.timeZone,
    });

    await slackClient.chat.postMessage({
      channel: config.targetChannelId,
      text: message,
      mrkdwn: true,
    });

    await markReviewRecapSentFn(pool, scheduledSlot.toISOString());
  } catch (error) {
    logger.error("Review recap scheduler tick failed.");
    logger.error(error.message);
  }
}

function logNoChannelConfigured({ logger, now, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastNoChannelLogMinuteKey === minuteKey) {
    return;
  }

  schedulerState.lastNoChannelLogMinuteKey = minuteKey;
  logger.info("Review recap scheduler skipped: no target channel configured.");
}

function hasSlotAlreadyBeenSent({ scheduledSlot, lastSentSlotAt }) {
  if (!lastSentSlotAt) {
    return false;
  }

  const sentTimestamp = lastSentSlotAt instanceof Date ? lastSentSlotAt : new Date(lastSentSlotAt);
  if (Number.isNaN(sentTimestamp.getTime())) {
    return false;
  }

  return sentTimestamp.getTime() >= scheduledSlot.getTime();
}

function computeSinceTimestamp({ now, recencyValue, recencyUnit }) {
  const parsedRecencyValue = Number(recencyValue);
  const normalizedRecencyValue = Number.isInteger(parsedRecencyValue) && parsedRecencyValue > 0
    ? parsedRecencyValue
    : 1;
  const normalizedRecencyUnit = String(recencyUnit || "").toLowerCase().trim();

  const durationDays = normalizedRecencyUnit === "d"
    ? normalizedRecencyValue
    : normalizedRecencyValue * 7;

  return new Date(now.getTime() - durationDays * 24 * 60 * 60 * 1000);
}

function findMostRecentScheduledSlot({ now, scheduleWeekday, scheduleTime, timeZone, lookbackMinutes }) {
  const normalizedScheduleWeekday = String(scheduleWeekday || "").toLowerCase().trim();
  const scheduleTimeParts = String(scheduleTime || "").split(":");
  if (scheduleTimeParts.length !== 2) {
    return null;
  }

  const scheduledHour = Number(scheduleTimeParts[0]);
  const scheduledMinute = Number(scheduleTimeParts[1]);
  if (!Number.isInteger(scheduledHour) || !Number.isInteger(scheduledMinute)) {
    return null;
  }

  const nowMinute = new Date(now);
  nowMinute.setUTCSeconds(0, 0);

  for (let offsetMinutes = 0; offsetMinutes <= lookbackMinutes; offsetMinutes += 1) {
    const candidateSlot = new Date(nowMinute.getTime() - offsetMinutes * 60 * 1000);
    const candidateParts = readTimeZoneMinuteParts(candidateSlot, timeZone);
    if (!candidateParts) {
      continue;
    }

    const candidateWeekday = normalizeShortWeekday(candidateParts.weekday);
    if (
      candidateWeekday === normalizedScheduleWeekday &&
      Number(candidateParts.hour) === scheduledHour &&
      Number(candidateParts.minute) === scheduledMinute
    ) {
      return candidateSlot;
    }
  }

  return null;
}

function readTimeZoneMinuteParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const partsByType = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        partsByType[part.type] = part.value;
      }
    }

    return {
      weekday: partsByType.weekday,
      hour: partsByType.hour,
      minute: partsByType.minute,
    };
  } catch (_error) {
    return null;
  }
}

function normalizeShortWeekday(shortWeekday) {
  const normalizedWeekday = String(shortWeekday || "").toLowerCase().trim();
  const weekdayMap = {
    mon: "mon",
    tue: "tue",
    wed: "wed",
    thu: "thu",
    fri: "fri",
    sat: "sat",
    sun: "sun",
  };

  return weekdayMap[normalizedWeekday] || null;
}

module.exports = {
  findMostRecentScheduledSlot,
  runReviewRecapSchedulerTick,
  startReviewRecapScheduler,
};
