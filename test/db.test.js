const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addUserToDeployWhitelist,
  createPool,
  isUserWhitelistedForDeploy,
  listRecentlyTestedPullRequests,
  markAllUntestedPullRequestsTested,
} = require("../src/db");

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
