const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addUserToDeployWhitelist,
  createPool,
  getConfiguredTimeFormat,
  getConfiguredTimeZone,
  getRuntimeProviderConfig,
  getReviewRecapConfig,
  isUserWhitelistedForDeploy,
  listOpenPullRequestsWaitingOnReviewSince,
  listRecentlyTestedPullRequests,
  markAllUntestedPullRequestsTested,
  setConfiguredCodeHostProvider,
  setConfiguredCommunicationProvider,
  setConfiguredDeployProvider,
  markStaleOpenPullRequestsClosed,
  markReviewRecapSent,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapSchedule,
  setReviewRecapTimeZone,
  updatePullRequestCodexApproval,
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntestedFromSync,
} = require("../../src/db");

test("createPool requires DATABASE_URL", () => {
  assert.throws(() => createPool(""), /DATABASE_URL is required/);
});

test("createPool does not force SSL when sslmode is absent", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso");
  assert.equal(pool.options.ssl, undefined);
  await pool.end();
});

test("createPool enables SSL for sslmode=require", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=require");
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  await pool.end();
});

test("createPool enables SSL for sslmode=verify-full", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=verify-full");
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  await pool.end();
});

test("createPool keeps SSL disabled for sslmode=disable", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=disable");
  assert.equal(pool.options.ssl, undefined);
  await pool.end();
});

test("markAllUntestedPullRequestsTested returns updated row count", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rowCount: 5 };
    },
  };

  const updatedCount = await markAllUntestedPullRequestsTested(pool, "U123");

  assert.equal(updatedCount, 5);
  assert.match(captured.sql, /WHERE status = 'untested'/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("listRecentlyTestedPullRequests returns queried rows", async () => {
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 99,
    status: "tested",
    tested_at: new Date("2026-02-13T00:00:00.000Z"),
    tested_by: "U123",
  };
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };

  const rows = await listRecentlyTestedPullRequests(pool, sinceTimestamp);

  assert.deepEqual(rows, [row]);
  assert.match(captured.sql, /tested_at >= \$1/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
});

test("isUserWhitelistedForDeploy returns true when user is present", async () => {
  const pool = {
    async query(_sql, _params) {
      return { rowCount: 1 };
    },
  };

  const isWhitelisted = await isUserWhitelistedForDeploy(pool, "U123");
  assert.equal(isWhitelisted, true);
});

test("isUserWhitelistedForDeploy returns false when user is absent", async () => {
  const pool = {
    async query(_sql, _params) {
      return { rowCount: 0 };
    },
  };

  const isWhitelisted = await isUserWhitelistedForDeploy(pool, "U123");
  assert.equal(isWhitelisted, false);
});

test("addUserToDeployWhitelist returns added=false when already present", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };

  const result = await addUserToDeployWhitelist(pool, "U123", "UADMIN");

  assert.deepEqual(result, { added: false });
  assert.equal(calls.length, 1);
});

test("addUserToDeployWhitelist inserts when user is not present", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return { rowCount: 0 };
      }
      return { rowCount: 1 };
    },
  };

  const result = await addUserToDeployWhitelist(pool, "U123", "UADMIN");

  assert.deepEqual(result, { added: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, ["U123", "UADMIN"]);
});

test("getConfiguredTimeFormat returns configured value", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ time_format: "long" }],
      };
    },
  };

  const result = await getConfiguredTimeFormat(pool, "U123");
  assert.equal(result, "long");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeFormat falls back to human when unset", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [],
      };
    },
  };

  const result = await getConfiguredTimeFormat(pool, "U123");
  assert.equal(result, "human");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeFormat falls back to human when user id missing", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  const result = await getConfiguredTimeFormat(pool);
  assert.equal(result, "human");
  assert.equal(queryCalled, false);
});

test("setConfiguredTimeFormat upserts selected format", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ time_format: "long", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredTimeFormat(pool, "long", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_user_config/);
  assert.deepEqual(captured.params, ["long", "UADMIN"]);
  assert.deepEqual(result, { time_format: "long", updated_by: "UADMIN" });
});

test("setConfiguredTimeFormat rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeFormat(pool, "invalid", "UADMIN");
  }, /Unsupported time format/);
});

test("setConfiguredTimeFormat requires user id", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeFormat(pool, "human", "");
  }, /user id is required/);
});

test("getConfiguredTimeZone returns configured value", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Los_Angeles" }],
      };
    },
  };

  const result = await getConfiguredTimeZone(pool, "U123");
  assert.equal(result, "America/Los_Angeles");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeZone falls back to default when unset", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [],
      };
    },
  };

  const result = await getConfiguredTimeZone(pool, "U123");
  assert.equal(result, "America/New_York");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeZone falls back to default when user id missing", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  const result = await getConfiguredTimeZone(pool);
  assert.equal(result, "America/New_York");
  assert.equal(queryCalled, false);
});

test("setConfiguredTimeZone upserts selected timezone", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Los_Angeles", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredTimeZone(pool, "America/Los_Angeles", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_user_config/);
  assert.deepEqual(captured.params, ["America/Los_Angeles", "UADMIN"]);
  assert.deepEqual(result, { timezone: "America/Los_Angeles", updated_by: "UADMIN" });
});

test("setConfiguredTimeZone rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeZone(pool, "", "UADMIN");
  }, /Unsupported timezone/);
});

test("setConfiguredTimeZone requires user id", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeZone(pool, "America/New_York", "");
  }, /user id is required/);
});

test("upsertOpenPullRequestReviewState upserts expected fields", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" }],
      };
    },
  };

  const result = await upsertOpenPullRequestReviewState(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    title: "Add observability",
    url: "https://github.com/croft-eng/croft/pull/77",
    authorLogin: "octocat",
    baseBranch: "main",
    isDraft: false,
    lifecycleState: "open",
    reviewState: "waiting",
    openedAt: "2026-02-16T13:00:00.000Z",
    openedForReviewAt: "2026-02-16T13:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    lastReviewedAt: null,
  });

  assert.match(captured.sql, /INSERT INTO open_pr_review_state/);
  assert.equal(captured.params[0], "croft-eng/croft");
  assert.equal(captured.params[1], 77);
  assert.equal(captured.params[8], "waiting");
  assert.equal(captured.params[14], null);
  assert.deepEqual(result, { repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" });
});

test("upsertPullRequestAsUntestedFromSync preserves tested/deployed states on conflict", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 88, status: "tested" }],
      };
    },
  };

  const result = await upsertPullRequestAsUntestedFromSync(pool, {
    repo: "croft-eng/croft",
    prNumber: 88,
    title: "Backfilled merged PR",
    url: "https://github.com/croft-eng/croft/pull/88",
    mergedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /INSERT INTO pull_requests/);
  assert.match(captured.sql, /ON CONFLICT \(repo, pr_number\)/);
  assert.match(captured.sql, /WHEN pull_requests.status = 'untested' THEN 'untested'/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    88,
    "Backfilled merged PR",
    "https://github.com/croft-eng/croft/pull/88",
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.status, "tested");
});

test("updatePullRequestReviewSubmission updates approved review state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "approved" }],
      };
    },
  };

  const result = await updatePullRequestReviewSubmission(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    reviewState: "approved",
    lastReviewedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    77,
    "approved",
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.review_state, "approved");
});

test("updatePullRequestReviewSubmission supports timestamp-only updates", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" }],
      };
    },
  };

  const result = await updatePullRequestReviewSubmission(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    reviewState: null,
    lastReviewedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /COALESCE\(\$3, review_state\)/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    77,
    null,
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.review_state, "waiting");
});

test("updatePullRequestReviewSubmission rejects unsupported review state", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await updatePullRequestReviewSubmission(pool, {
      repo: "croft-eng/croft",
      prNumber: 77,
      reviewState: "dismissed",
      lastReviewedAt: "2026-02-16T14:00:00.000Z",
    });
  }, /Unsupported review state/);
});

test("updatePullRequestCodexApproval updates codex approval state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, codex_approved: true }],
      };
    },
  };

  const result = await updatePullRequestCodexApproval(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    codexApproved: true,
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.match(captured.sql, /SET codex_approved = \$3/);
  assert.deepEqual(captured.params, ["croft-eng/croft", 77, true]);
  assert.equal(result.codex_approved, true);
});

test("listOpenPullRequestsWaitingOnReviewSince returns rows in recency window", async () => {
  const captured = {};
  const sinceTimestamp = new Date("2026-02-09T14:00:00.000Z");
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 71, author_login: "octocat" }],
      };
    },
  };

  const result = await listOpenPullRequestsWaitingOnReviewSince(pool, sinceTimestamp);

  assert.match(captured.sql, /FROM open_pr_review_state/);
  assert.match(captured.sql, /lifecycle_state = 'open'/);
  assert.match(captured.sql, /review_state IN \('waiting', 'changes_requested'\)/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
  assert.equal(result.length, 1);
  assert.equal(result[0].pr_number, 71);
});

test("markStaleOpenPullRequestsClosed closes unmatched open rows for repo and branch", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rowCount: 3 };
    },
  };

  const closedCount = await markStaleOpenPullRequestsClosed(pool, {
    repo: "croft-eng/croft",
    baseBranch: "main",
    openPrNumbers: [71, 72],
    closedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.match(captured.sql, /NOT \(pr_number = ANY\(\$3::INT\[\]\)\)/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    "main",
    [71, 72],
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(closedCount, 3);
});

test("getReviewRecapConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.targetChannelId, null);
  assert.equal(result.recencyValue, 1);
  assert.equal(result.recencyUnit, "w");
  assert.equal(result.scheduleWeekday, "mon");
  assert.equal(result.scheduleTime, "09:00");
  assert.equal(result.timeZone, "America/New_York");
  assert.equal(result.lastSentSlotAt, null);
});

test("getReviewRecapConfig returns configured values", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            target_channel_id: "C123",
            recency_value: 2,
            recency_unit: "d",
            schedule_weekday: "tue",
            schedule_time: "10:15",
            timezone: "America/Los_Angeles",
            last_sent_slot_at: "2026-02-16T17:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.targetChannelId, "C123");
  assert.equal(result.recencyValue, 2);
  assert.equal(result.recencyUnit, "d");
  assert.equal(result.scheduleWeekday, "tue");
  assert.equal(result.scheduleTime, "10:15");
  assert.equal(result.timeZone, "America/Los_Angeles");
  assert.equal(result.lastSentSlotAt, "2026-02-16T17:00:00.000Z");
});

test("getReviewRecapConfig supports daily schedule weekday", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            target_channel_id: "C123",
            recency_value: 1,
            recency_unit: "w",
            schedule_weekday: "daily",
            schedule_time: "09:00",
            timezone: "America/New_York",
            last_sent_slot_at: null,
          },
        ],
      };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.scheduleWeekday, "daily");
  assert.equal(result.scheduleTime, "09:00");
});

test("getRuntimeProviderConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await getRuntimeProviderConfig(pool);

  assert.deepEqual(result, {
    communicationProvider: "slack",
    codeHostProvider: "github",
    deployProvider: "digitalocean",
  });
});

test("getRuntimeProviderConfig returns configured providers", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            communication_provider: "microsoft_teams",
            code_host_provider: "bitbucket",
            deploy_provider: "aws",
          },
        ],
      };
    },
  };

  const result = await getRuntimeProviderConfig(pool);

  assert.deepEqual(result, {
    communicationProvider: "microsoft_teams",
    codeHostProvider: "bitbucket",
    deployProvider: "aws",
  });
});

test("setReviewRecapChannel upserts channel", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ target_channel_id: "C123", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapChannel(pool, "C123", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.deepEqual(captured.params.slice(0, 2), ["C123", null]);
  assert.equal(result.target_channel_id, "C123");
});

test("setReviewRecapChannel rejects missing channel", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapChannel(pool, "", "UADMIN");
  }, /Unsupported review recap channel id/);
});

test("setReviewRecapRecency upserts recency", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ recency_value: 2, recency_unit: "w", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapRecency(pool, 2, "w", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[1], 2);
  assert.equal(captured.params[2], "w");
  assert.equal(result.recency_value, 2);
  assert.equal(result.recency_unit, "w");
});

test("setReviewRecapRecency rejects unsupported unit", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapRecency(pool, 2, "month", "UADMIN");
  }, /Unsupported review recap recency unit/);
});

test("setReviewRecapSchedule upserts schedule", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ schedule_weekday: "tue", schedule_time: "10:15", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSchedule(pool, "tue", "10:15", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[3], "tue");
  assert.equal(captured.params[4], "10:15");
  assert.ok(captured.params[6]);
  assert.equal(Number.isNaN(Date.parse(captured.params[6])), false);
  assert.equal(result.schedule_weekday, "tue");
  assert.equal(result.schedule_time, "10:15");
});

test("setReviewRecapSchedule accepts daily schedule keyword", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ schedule_weekday: "daily", schedule_time: "09:00", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSchedule(pool, "daily", "09:00", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[3], "daily");
  assert.equal(captured.params[4], "09:00");
  assert.ok(captured.params[6]);
  assert.equal(Number.isNaN(Date.parse(captured.params[6])), false);
  assert.equal(result.schedule_weekday, "daily");
  assert.equal(result.schedule_time, "09:00");
});

test("setReviewRecapSchedule rejects invalid time", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapSchedule(pool, "mon", "25:10", "UADMIN");
  }, /Unsupported review recap schedule time/);
});

test("setReviewRecapTimeZone upserts timezone", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Chicago", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapTimeZone(pool, "America/Chicago", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[5], "America/Chicago");
  assert.equal(result.timezone, "America/Chicago");
});

test("setConfiguredCommunicationProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ communication_provider: "slack", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredCommunicationProvider(pool, "slack", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[0], "slack");
  assert.equal(result.communication_provider, "slack");
});

test("setConfiguredCodeHostProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ code_host_provider: "github", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredCodeHostProvider(pool, "github", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[1], "github");
  assert.equal(result.code_host_provider, "github");
});

test("setConfiguredDeployProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ deploy_provider: "digitalocean", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredDeployProvider(pool, "digitalocean", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[2], "digitalocean");
  assert.equal(result.deploy_provider, "digitalocean");
});

test("setConfiguredDeployProvider rejects unsupported provider", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredDeployProvider(pool, "render", "UADMIN");
  }, /Unsupported deploy provider/);
});

test("markReviewRecapSent updates last sent slot", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ id: 1, last_sent_slot_at: "2026-02-16T14:00:00.000Z" }],
      };
    },
  };

  const result = await markReviewRecapSent(pool, "2026-02-16T14:00:00.000Z");

  assert.match(captured.sql, /UPDATE review_recap_config/);
  assert.deepEqual(captured.params, ["2026-02-16T14:00:00.000Z"]);
  assert.equal(result.id, 1);
});
