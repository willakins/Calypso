const assert = require("node:assert/strict");
const test = require("node:test");

const { createPool } = require("../src/db");

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
