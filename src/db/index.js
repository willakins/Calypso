const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const MIGRATIONS_DIRECTORY_PATH = path.join(__dirname, "migrations");
const EPOCH_UTC_TIMESTAMP_SQL = "TIMESTAMPTZ '1970-01-01 00:00:00+00'";
const TLS_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const TIME_FORMATS = Object.freeze({
  human: "human",
  long: "long",
});
const DEFAULT_TIME_FORMAT = TIME_FORMATS.human;
const DEFAULT_TIME_ZONE = "America/New_York";
const REVIEW_RECAP_RECENCY_UNITS = Object.freeze({
  day: "d",
  week: "w",
});
const REVIEW_RECAP_WEEKDAYS = Object.freeze({
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat",
  sun: "sun",
});
const REVIEW_RECAP_DEFAULTS = Object.freeze({
  recencyValue: 1,
  recencyUnit: REVIEW_RECAP_RECENCY_UNITS.week,
  scheduleWeekday: REVIEW_RECAP_WEEKDAYS.mon,
  scheduleTime: "09:00",
  timeZone: DEFAULT_TIME_ZONE,
});

function createPool(databaseConnectionString) {
  if (!databaseConnectionString || databaseConnectionString.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool(buildPoolConfiguration(databaseConnectionString));
}

function buildPoolConfiguration(databaseConnectionString) {
  const poolConfiguration = {
    connectionString: databaseConnectionString,
  };

  if (isTlsRequiredByDatabaseUrl(databaseConnectionString)) {
    // DigitalOcean managed Postgres commonly uses sslmode=require. In local/dev
    // environments this stays disabled unless explicitly requested in DATABASE_URL.
    poolConfiguration.ssl = { rejectUnauthorized: false };
  }

  return poolConfiguration;
}

function isTlsRequiredByDatabaseUrl(databaseConnectionString) {
  const sslMode = readSslModeFromDatabaseUrl(databaseConnectionString);
  return TLS_SSL_MODES.has(sslMode);
}

function readSslModeFromDatabaseUrl(databaseConnectionString) {
  try {
    const parsedDatabaseUrl = new URL(databaseConnectionString);
    return (parsedDatabaseUrl.searchParams.get("sslmode") || "").toLowerCase();
  } catch (_error) {
    const match = databaseConnectionString.match(/(?:\?|&)sslmode=([^&]+)/i);
    return match ? decodeURIComponent(match[1]).toLowerCase() : "";
  }
}

async function verifyConnection(pool) {
  await pool.query("SELECT 1");
}

async function runMigrations(pool) {
  const migrationFilePaths = readMigrationFilePaths(MIGRATIONS_DIRECTORY_PATH);
  for (const migrationFilePath of migrationFilePaths) {
    const migrationSql = fs.readFileSync(migrationFilePath, "utf8");
    await pool.query(migrationSql);
  }
}

function readMigrationFilePaths(migrationsDirectoryPath) {
  return fs
    .readdirSync(migrationsDirectoryPath)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => path.join(migrationsDirectoryPath, filename));
}

async function getLastProdDeployAt(pool) {
  const query = `
    SELECT COALESCE(MAX(deployed_at), ${EPOCH_UTC_TIMESTAMP_SQL}) AS last_deploy_at
    FROM deployments
    WHERE environment = 'prod'
  `;
  const result = await pool.query(query);
  return result.rows[0].last_deploy_at;
}

async function listBlockingPullRequests(pool, lastDeployAt) {
  const query = `
    SELECT repo, pr_number, title, status, merged_at
    FROM pull_requests
    WHERE merged_at > $1
      AND status NOT IN ('tested', 'deployed')
    ORDER BY merged_at ASC, pr_number ASC
  `;
  const result = await pool.query(query, [lastDeployAt]);
  return result.rows;
}

async function upsertPullRequestAsUntested(pool, pullRequest) {
  const query = `
    INSERT INTO pull_requests (
      repo,
      pr_number,
      title,
      url,
      status,
      merged_at,
      tested_at,
      tested_by,
      deployed_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'untested', $5, NULL, NULL, NULL, NOW())
    ON CONFLICT (repo, pr_number)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      status = 'untested',
      merged_at = EXCLUDED.merged_at,
      tested_at = NULL,
      tested_by = NULL,
      deployed_at = NULL,
      updated_at = NOW()
    RETURNING id, repo, pr_number, status, merged_at
  `;
  const queryValues = [
    pullRequest.repo,
    pullRequest.prNumber,
    pullRequest.title,
    pullRequest.url,
    pullRequest.mergedAt,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function markPullRequestTested(pool, prNumber, testedBy) {
  const existingPullRequest = await findMostRecentPullRequestByNumber(pool, prNumber);
  if (!existingPullRequest) {
    return { found: false };
  }

  if (existingPullRequest.status === "tested") {
    return {
      found: true,
      alreadyTested: true,
      pullRequest: existingPullRequest,
    };
  }

  const updateQuery = `
    UPDATE pull_requests
    SET status = 'tested',
        tested_at = NOW(),
        tested_by = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, pr_number, status, tested_at, tested_by
  `;
  const updatedResult = await pool.query(updateQuery, [existingPullRequest.id, testedBy || null]);

  return {
    found: true,
    alreadyTested: false,
    pullRequest: updatedResult.rows[0],
  };
}

async function findMostRecentPullRequestByNumber(pool, prNumber) {
  const query = `
    SELECT id, pr_number, status, tested_at, tested_by
    FROM pull_requests
    WHERE pr_number = $1
    ORDER BY merged_at DESC
    LIMIT 1
  `;
  const result = await pool.query(query, [prNumber]);
  return result.rows[0] || null;
}

async function insertDeployment(pool, deployment) {
  const query = `
    INSERT INTO deployments (environment, provider, external_deploy_id, deployed_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id, environment, provider, external_deploy_id, deployed_at
  `;
  const queryValues = [
    deployment.environment,
    deployment.provider,
    deployment.externalDeployId || null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function markPullRequestsDeployedSince(pool, lastDeployAt, deployedAt) {
  const query = `
    UPDATE pull_requests
    SET status = 'deployed',
        deployed_at = $2,
        updated_at = NOW()
    WHERE merged_at > $1
      AND status = 'tested'
    RETURNING id
  `;
  const result = await pool.query(query, [lastDeployAt, deployedAt]);
  return result.rowCount;
}

async function markAllUntestedPullRequestsTested(pool, testedBy) {
  const query = `
    UPDATE pull_requests
    SET status = 'tested',
        tested_at = NOW(),
        tested_by = $1,
        updated_at = NOW()
    WHERE status = 'untested'
    RETURNING id
  `;
  const result = await pool.query(query, [testedBy || null]);
  return result.rowCount;
}

async function listRecentlyTestedPullRequests(pool, sinceTimestamp) {
  const query = `
    SELECT repo, pr_number, title, status, tested_at, tested_by
    FROM pull_requests
    WHERE tested_at IS NOT NULL
      AND tested_at >= $1
    ORDER BY tested_at DESC, pr_number DESC
  `;
  const result = await pool.query(query, [sinceTimestamp]);
  return result.rows;
}

async function upsertOpenPullRequestReviewState(pool, pullRequestState) {
  const query = `
    INSERT INTO open_pr_review_state (
      repo,
      pr_number,
      title,
      url,
      author_login,
      base_branch,
      is_draft,
      lifecycle_state,
      review_state,
      opened_at,
      opened_for_review_at,
      closed_at,
      merged_at,
      last_reviewed_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
    )
    ON CONFLICT (repo, pr_number)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      author_login = EXCLUDED.author_login,
      base_branch = EXCLUDED.base_branch,
      is_draft = EXCLUDED.is_draft,
      lifecycle_state = EXCLUDED.lifecycle_state,
      review_state = EXCLUDED.review_state,
      opened_at = EXCLUDED.opened_at,
      opened_for_review_at = EXCLUDED.opened_for_review_at,
      closed_at = EXCLUDED.closed_at,
      merged_at = EXCLUDED.merged_at,
      last_reviewed_at = COALESCE(EXCLUDED.last_reviewed_at, open_pr_review_state.last_reviewed_at),
      updated_at = NOW()
    RETURNING
      repo,
      pr_number,
      title,
      author_login,
      lifecycle_state,
      review_state,
      opened_for_review_at
  `;
  const queryValues = [
    pullRequestState.repo,
    pullRequestState.prNumber,
    pullRequestState.title || null,
    pullRequestState.url || null,
    pullRequestState.authorLogin,
    pullRequestState.baseBranch,
    Boolean(pullRequestState.isDraft),
    pullRequestState.lifecycleState,
    pullRequestState.reviewState,
    pullRequestState.openedAt,
    pullRequestState.openedForReviewAt || null,
    pullRequestState.closedAt || null,
    pullRequestState.mergedAt || null,
    pullRequestState.lastReviewedAt || null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function updatePullRequestReviewSubmission(pool, reviewStateUpdate) {
  const hasReviewState = reviewStateUpdate.reviewState !== undefined && reviewStateUpdate.reviewState !== null;
  const normalizedReviewState = hasReviewState
    ? normalizePullRequestReviewState(reviewStateUpdate.reviewState)
    : null;
  if (hasReviewState && !normalizedReviewState) {
    throw new Error(`Unsupported review state: ${reviewStateUpdate.reviewState}`);
  }

  const query = `
    UPDATE open_pr_review_state
    SET review_state = COALESCE($3, review_state),
        last_reviewed_at = $4,
        updated_at = NOW()
    WHERE repo = $1
      AND pr_number = $2
    RETURNING repo, pr_number, review_state, last_reviewed_at
  `;
  const queryValues = [
    reviewStateUpdate.repo,
    reviewStateUpdate.prNumber,
    normalizedReviewState,
    reviewStateUpdate.lastReviewedAt || null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0] || null;
}

async function listOpenPullRequestsWaitingOnReviewSince(pool, sinceTimestamp) {
  const query = `
    SELECT
      repo,
      pr_number,
      title,
      url,
      author_login,
      opened_for_review_at
    FROM open_pr_review_state
    WHERE lifecycle_state = 'open'
      AND is_draft = false
      AND review_state IN ('waiting', 'changes_requested')
      AND opened_for_review_at IS NOT NULL
      AND opened_for_review_at >= $1
    ORDER BY opened_for_review_at ASC, pr_number ASC
  `;
  const result = await pool.query(query, [sinceTimestamp]);
  return result.rows;
}

async function getReviewRecapConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        target_channel_id,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        timezone,
        last_sent_slot_at
      FROM review_recap_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  const row = result.rows[0];
  if (!row) {
    return {
      targetChannelId: null,
      recencyValue: REVIEW_RECAP_DEFAULTS.recencyValue,
      recencyUnit: REVIEW_RECAP_DEFAULTS.recencyUnit,
      scheduleWeekday: REVIEW_RECAP_DEFAULTS.scheduleWeekday,
      scheduleTime: REVIEW_RECAP_DEFAULTS.scheduleTime,
      timeZone: REVIEW_RECAP_DEFAULTS.timeZone,
      lastSentSlotAt: null,
    };
  }

  return {
    targetChannelId: row.target_channel_id || null,
    recencyValue: row.recency_value || REVIEW_RECAP_DEFAULTS.recencyValue,
    recencyUnit: normalizeReviewRecencyUnit(row.recency_unit) || REVIEW_RECAP_DEFAULTS.recencyUnit,
    scheduleWeekday:
      normalizeReviewScheduleWeekday(row.schedule_weekday) || REVIEW_RECAP_DEFAULTS.scheduleWeekday,
    scheduleTime:
      normalizeReviewScheduleTime(row.schedule_time) || REVIEW_RECAP_DEFAULTS.scheduleTime,
    timeZone: normalizeTimeZone(row.timezone) || REVIEW_RECAP_DEFAULTS.timeZone,
    lastSentSlotAt: row.last_sent_slot_at || null,
  };
}

async function setReviewRecapChannel(pool, targetChannelId, updatedBy) {
  const normalizedChannelId = normalizeReviewRecapChannelId(targetChannelId);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedChannelId) {
    throw new Error(`Unsupported review recap channel id: ${targetChannelId}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    targetChannelId: normalizedChannelId,
    updatedBy: normalizedSlackUserId,
  });
}

async function setReviewRecapRecency(pool, recencyValue, recencyUnit, updatedBy) {
  const normalizedRecencyValue = normalizePositiveInteger(recencyValue);
  const normalizedRecencyUnit = normalizeReviewRecencyUnit(recencyUnit);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedRecencyValue) {
    throw new Error(`Unsupported review recap recency value: ${recencyValue}`);
  }
  if (!normalizedRecencyUnit) {
    throw new Error(`Unsupported review recap recency unit: ${recencyUnit}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    recencyValue: normalizedRecencyValue,
    recencyUnit: normalizedRecencyUnit,
    updatedBy: normalizedSlackUserId,
  });
}

async function setReviewRecapSchedule(pool, scheduleWeekday, scheduleTime, updatedBy) {
  const normalizedScheduleWeekday = normalizeReviewScheduleWeekday(scheduleWeekday);
  const normalizedScheduleTime = normalizeReviewScheduleTime(scheduleTime);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedScheduleWeekday) {
    throw new Error(`Unsupported review recap schedule weekday: ${scheduleWeekday}`);
  }
  if (!normalizedScheduleTime) {
    throw new Error(`Unsupported review recap schedule time: ${scheduleTime}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    scheduleWeekday: normalizedScheduleWeekday,
    scheduleTime: normalizedScheduleTime,
    updatedBy: normalizedSlackUserId,
  });
}

async function setReviewRecapTimeZone(pool, timeZone, updatedBy) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedTimeZone) {
    throw new Error(`Unsupported review recap timezone: ${timeZone}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    timeZone: normalizedTimeZone,
    updatedBy: normalizedSlackUserId,
  });
}

async function markReviewRecapSent(pool, scheduledSlotAt) {
  const result = await pool.query(
    `
      UPDATE review_recap_config
      SET last_sent_slot_at = $1,
          updated_at = NOW()
      WHERE id = 1
      RETURNING id, last_sent_slot_at
    `,
    [scheduledSlotAt],
  );
  return result.rows[0] || null;
}

async function upsertReviewRecapConfig(pool, updates) {
  const result = await pool.query(
    `
      INSERT INTO review_recap_config (
        id,
        target_channel_id,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        timezone,
        updated_by,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, NULL),
        COALESCE($2, ${REVIEW_RECAP_DEFAULTS.recencyValue}),
        COALESCE($3, '${REVIEW_RECAP_DEFAULTS.recencyUnit}'),
        COALESCE($4, '${REVIEW_RECAP_DEFAULTS.scheduleWeekday}'),
        COALESCE($5, '${REVIEW_RECAP_DEFAULTS.scheduleTime}'),
        COALESCE($6, '${REVIEW_RECAP_DEFAULTS.timeZone}'),
        $7,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        target_channel_id = COALESCE($1, review_recap_config.target_channel_id),
        recency_value = COALESCE($2, review_recap_config.recency_value),
        recency_unit = COALESCE($3, review_recap_config.recency_unit),
        schedule_weekday = COALESCE($4, review_recap_config.schedule_weekday),
        schedule_time = COALESCE($5, review_recap_config.schedule_time),
        timezone = COALESCE($6, review_recap_config.timezone),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING
        target_channel_id,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        timezone,
        last_sent_slot_at,
        updated_by,
        updated_at
    `,
    [
      updates.targetChannelId || null,
      updates.recencyValue || null,
      updates.recencyUnit || null,
      updates.scheduleWeekday || null,
      updates.scheduleTime || null,
      updates.timeZone || null,
      updates.updatedBy || null,
    ],
  );

  return result.rows[0];
}

async function isUserWhitelistedForDeploy(pool, slackUserId) {
  const query = `
    SELECT 1
    FROM deployment_whitelist
    WHERE slack_user_id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [slackUserId]);
  return result.rowCount > 0;
}

async function addUserToDeployWhitelist(pool, slackUserId, addedBy) {
  const existingRecord = await pool.query(
    `
      SELECT slack_user_id
      FROM deployment_whitelist
      WHERE slack_user_id = $1
    `,
    [slackUserId],
  );
  if (existingRecord.rowCount > 0) {
    return { added: false };
  }

  await pool.query(
    `
      INSERT INTO deployment_whitelist (slack_user_id, added_by, updated_at)
      VALUES ($1, $2, NOW())
    `,
    [slackUserId, addedBy],
  );
  return { added: true };
}

async function getConfiguredTimeFormat(pool, slackUserId) {
  const normalizedSlackUserId = normalizeSlackUserId(slackUserId);
  if (!normalizedSlackUserId) {
    return DEFAULT_TIME_FORMAT;
  }

  const result = await pool.query(
    `
      SELECT time_format
      FROM runtime_user_config
      WHERE slack_user_id = $1
      LIMIT 1
    `,
    [normalizedSlackUserId],
  );

  const configuredValue = result.rows[0]?.time_format || DEFAULT_TIME_FORMAT;
  return normalizeTimeFormat(configuredValue) || DEFAULT_TIME_FORMAT;
}

async function getConfiguredTimeZone(pool, slackUserId) {
  const normalizedSlackUserId = normalizeSlackUserId(slackUserId);
  if (!normalizedSlackUserId) {
    return DEFAULT_TIME_ZONE;
  }

  const result = await pool.query(
    `
      SELECT timezone
      FROM runtime_user_config
      WHERE slack_user_id = $1
      LIMIT 1
    `,
    [normalizedSlackUserId],
  );

  return normalizeTimeZone(result.rows[0]?.timezone) || DEFAULT_TIME_ZONE;
}

async function setConfiguredTimeFormat(pool, timeFormat, updatedBy) {
  const normalizedTimeFormat = normalizeTimeFormat(timeFormat);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedTimeFormat) {
    throw new Error(`Unsupported time format: ${timeFormat}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  const result = await pool.query(
    `
      INSERT INTO runtime_user_config (slack_user_id, time_format, updated_by, updated_at)
      VALUES ($2, $1, $2, NOW())
      ON CONFLICT (slack_user_id)
      DO UPDATE SET
        time_format = EXCLUDED.time_format,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING time_format, updated_by, updated_at
    `,
    [normalizedTimeFormat, normalizedSlackUserId],
  );

  return result.rows[0];
}

async function setConfiguredTimeZone(pool, timeZone, updatedBy) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const normalizedSlackUserId = normalizeSlackUserId(updatedBy);
  if (!normalizedTimeZone) {
    throw new Error(`Unsupported timezone: ${timeZone}`);
  }
  if (!normalizedSlackUserId) {
    throw new Error("slack user id is required");
  }

  const result = await pool.query(
    `
      INSERT INTO runtime_user_config (slack_user_id, timezone, updated_by, updated_at)
      VALUES ($2, $1, $2, NOW())
      ON CONFLICT (slack_user_id)
      DO UPDATE SET
        timezone = EXCLUDED.timezone,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING timezone, updated_by, updated_at
    `,
    [normalizedTimeZone, normalizedSlackUserId],
  );

  return result.rows[0];
}

function normalizeTimeFormat(timeFormat) {
  const normalizedTimeFormat = String(timeFormat || "").toLowerCase().trim();
  return TIME_FORMATS[normalizedTimeFormat] || null;
}

function normalizeTimeZone(timeZone) {
  const normalizedTimeZone = String(timeZone || "").trim();
  return normalizedTimeZone === "" ? null : normalizedTimeZone;
}

function normalizeSlackUserId(slackUserId) {
  const normalizedSlackUserId = String(slackUserId || "").trim();
  return normalizedSlackUserId === "" ? null : normalizedSlackUserId;
}

function normalizeReviewRecencyUnit(recencyUnit) {
  const normalizedRecencyUnit = String(recencyUnit || "").toLowerCase().trim();
  return Object.values(REVIEW_RECAP_RECENCY_UNITS).includes(normalizedRecencyUnit)
    ? normalizedRecencyUnit
    : null;
}

function normalizeReviewScheduleWeekday(scheduleWeekday) {
  const normalizedScheduleWeekday = String(scheduleWeekday || "").toLowerCase().trim();
  return REVIEW_RECAP_WEEKDAYS[normalizedScheduleWeekday] || null;
}

function normalizeReviewScheduleTime(scheduleTime) {
  const normalizedScheduleTime = String(scheduleTime || "").trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalizedScheduleTime)
    ? normalizedScheduleTime
    : null;
}

function normalizeReviewRecapChannelId(targetChannelId) {
  const normalizedChannelId = String(targetChannelId || "").trim();
  return normalizedChannelId === "" ? null : normalizedChannelId;
}

function normalizePositiveInteger(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function normalizePullRequestReviewState(reviewState) {
  const normalizedReviewState = String(reviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedReviewState === "waiting") {
    return "waiting";
  }
  return null;
}

module.exports = {
  addUserToDeployWhitelist,
  createPool,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONE,
  REVIEW_RECAP_DEFAULTS,
  REVIEW_RECAP_RECENCY_UNITS,
  REVIEW_RECAP_WEEKDAYS,
  getConfiguredTimeZone,
  getReviewRecapConfig,
  getLastProdDeployAt,
  getConfiguredTimeFormat,
  isUserWhitelistedForDeploy,
  insertDeployment,
  listRecentlyTestedPullRequests,
  listOpenPullRequestsWaitingOnReviewSince,
  listBlockingPullRequests,
  markAllUntestedPullRequestsTested,
  markReviewRecapSent,
  markPullRequestsDeployedSince,
  markPullRequestTested,
  runMigrations,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapSchedule,
  setReviewRecapTimeZone,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  TIME_FORMATS,
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntested,
  verifyConnection,
};
