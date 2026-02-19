const {
  getReviewRecapConfig,
  listOpenPullRequestsWaitingOnReviewSince,
  markReviewRecapSent,
} = require("../db");
const { formatReviewRecapResponse } = require("../util/format");

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const SCHEDULE_LOOKBACK_MINUTES = 8 * 24 * 60;
const MAX_POST_ATTEMPTS_PER_SLOT = 3;
const DAILY_SCHEDULE_WEEKDAY = "daily";

function startReviewRecapScheduler(options) {
  const {
    communicationClient = null,
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
  const messageClient = communicationClient || createSlackMessageClientAdapter(slackClient);

  if (!pool || !messageClient || typeof messageClient.postChannelMessage !== "function") {
    logger.warn("Review recap scheduler disabled: missing pool or communication message client.");
    return {
      stop() {},
    };
  }

  const schedulerState = buildSchedulerState();

  async function tick() {
    await runReviewRecapSchedulerTick({
      getReviewRecapConfigFn,
      listOpenPullRequestsWaitingOnReviewSinceFn,
      markReviewRecapSentFn,
      formatReviewRecapResponseFn,
      nowFn,
      logger,
      messageClient,
      pool,
      schedulerState,
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
  messageClient,
  slackClient,
  pool,
  schedulerState,
}) {
  const effectiveSchedulerState = ensureSchedulerState(schedulerState);

  try {
    const effectiveMessageClient = messageClient || createSlackMessageClientAdapter(slackClient);
    if (!effectiveMessageClient || typeof effectiveMessageClient.postChannelMessage !== "function") {
      logger.warn("Review recap scheduler tick skipped: no communication message client configured.");
      return;
    }

    const now = nowFn();
    const config = await getReviewRecapConfigFn(pool);
    if (!config.targetChannelId) {
      logNoChannelConfigured({ logger, now, schedulerState: effectiveSchedulerState });
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
    const slotKey = scheduledSlot.toISOString();
    if (hasReachedPostAttemptLimit({ schedulerState: effectiveSchedulerState, slotKey })) {
      logPostAttemptLimitReached({
        logger,
        schedulerState: effectiveSchedulerState,
        slotKey,
      });
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

    try {
      await effectiveMessageClient.postChannelMessage({
        channelId: config.targetChannelId,
        text: message,
        mrkdwn: true,
      });
    } catch (error) {
      const attemptCount = recordFailedPostAttempt({
        schedulerState: effectiveSchedulerState,
        slotKey,
      });
      logPostError({
        schedulerState: effectiveSchedulerState,
        logger,
        error,
        attemptCount,
        slotKey,
      });
      return;
    }

    await markReviewRecapSentFn(pool, scheduledSlot.toISOString());
    clearPostAttemptState({
      schedulerState: effectiveSchedulerState,
      slotKey,
    });
  } catch (error) {
    logger.error("Review recap scheduler tick failed.");
    logger.error(error.message);
  }
}

function createSlackMessageClientAdapter(slackClient) {
  if (!slackClient || !slackClient.chat || typeof slackClient.chat.postMessage !== "function") {
    return null;
  }

  return {
    async postChannelMessage({ channelId, mrkdwn, text }) {
      await slackClient.chat.postMessage({
        channel: channelId,
        mrkdwn,
        text,
      });
    },
  };
}

function logNoChannelConfigured({ logger, now, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastNoChannelLogMinuteKey === minuteKey) {
    return;
  }

  schedulerState.lastNoChannelLogMinuteKey = minuteKey;
  logger.info("Review recap scheduler skipped: no target channel configured.");
}

function buildSchedulerState() {
  return {
    lastNoChannelLogMinuteKey: null,
    postAttemptCountBySlotKey: new Map(),
    loggedPostAttemptLimitBySlotKey: new Set(),
  };
}

function ensureSchedulerState(schedulerState) {
  if (!schedulerState) {
    return buildSchedulerState();
  }

  if (!(schedulerState.postAttemptCountBySlotKey instanceof Map)) {
    schedulerState.postAttemptCountBySlotKey = new Map();
  }
  if (!(schedulerState.loggedPostAttemptLimitBySlotKey instanceof Set)) {
    schedulerState.loggedPostAttemptLimitBySlotKey = new Set();
  }

  return schedulerState;
}

function hasReachedPostAttemptLimit({ schedulerState, slotKey }) {
  const attemptCount = schedulerState.postAttemptCountBySlotKey.get(slotKey) || 0;
  return attemptCount >= MAX_POST_ATTEMPTS_PER_SLOT;
}

function recordFailedPostAttempt({ schedulerState, slotKey }) {
  const previousAttemptCount = schedulerState.postAttemptCountBySlotKey.get(slotKey) || 0;
  const nextAttemptCount = previousAttemptCount + 1;
  schedulerState.postAttemptCountBySlotKey.set(slotKey, nextAttemptCount);
  return nextAttemptCount;
}

function clearPostAttemptState({ schedulerState, slotKey }) {
  schedulerState.postAttemptCountBySlotKey.delete(slotKey);
  schedulerState.loggedPostAttemptLimitBySlotKey.delete(slotKey);
}

function logPostAttemptLimitReached({ logger, schedulerState, slotKey }) {
  if (schedulerState.loggedPostAttemptLimitBySlotKey.has(slotKey)) {
    return;
  }

  schedulerState.loggedPostAttemptLimitBySlotKey.add(slotKey);
  logger.error(
    `Review recap scheduler reached max retry attempts (${MAX_POST_ATTEMPTS_PER_SLOT}) for slot ${slotKey}. Skipping further retries until next scheduled slot.`,
  );
}

function logPostError({ schedulerState, logger, error, attemptCount, slotKey }) {
  logger.error("Review recap scheduler tick failed.");

  const errorCode = readErrorCode(error);
  if (errorCode === "not_in_channel") {
    logger.error(
      [
        "Review recap post failed: bot is not in the configured channel (`not_in_channel`).",
        "Invite the bot to that channel and rerun `/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`.",
      ].join(" "),
    );
  } else {
    logger.error(error?.message || String(error));
  }

  logger.error(
    `Review recap post attempt ${attemptCount}/${MAX_POST_ATTEMPTS_PER_SLOT} failed for slot ${slotKey}.`,
  );

  if (attemptCount >= MAX_POST_ATTEMPTS_PER_SLOT) {
    schedulerState.loggedPostAttemptLimitBySlotKey.add(slotKey);
    logger.error(
      `Review recap scheduler reached max retry attempts (${MAX_POST_ATTEMPTS_PER_SLOT}) for slot ${slotKey}. Skipping further retries until next scheduled slot.`,
    );
  }
}

function readErrorCode(error) {
  const codeFromPayload = String(error?.data?.error || "").trim().toLowerCase();
  if (codeFromPayload) {
    return codeFromPayload;
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not_in_channel")) {
    return "not_in_channel";
  }

  return "";
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
      (
        normalizedScheduleWeekday === DAILY_SCHEDULE_WEEKDAY ||
        candidateWeekday === normalizedScheduleWeekday
      ) &&
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
