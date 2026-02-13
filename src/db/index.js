const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

function createPool(databaseUrl) {
  if (!databaseUrl || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool({ connectionString: databaseUrl });
}

async function verifyConnection(pool) {
  await pool.query("SELECT 1");
}

async function runMigrations(pool) {
  const migrationPath = path.join(__dirname, "migrations", "001_init.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  await pool.query(sql);
}

async function getLastProdDeployAt(pool) {
  const result = await pool.query(`
    SELECT COALESCE(MAX(deployed_at), TIMESTAMPTZ '1970-01-01 00:00:00+00') AS last_deploy_at
    FROM deployments
    WHERE environment = 'prod'
  `);

  return result.rows[0].last_deploy_at;
}

async function listBlockingPullRequests(pool, lastDeployAt) {
  const result = await pool.query(
    `
      SELECT repo, pr_number, title, status, merged_at
      FROM pull_requests
      WHERE merged_at > $1
        AND status NOT IN ('tested', 'deployed')
      ORDER BY merged_at ASC, pr_number ASC
    `,
    [lastDeployAt],
  );

  return result.rows;
}

async function upsertPullRequestAsUntested(pool, pullRequest) {
  const result = await pool.query(
    `
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
    `,
    [pullRequest.repo, pullRequest.prNumber, pullRequest.title, pullRequest.url, pullRequest.mergedAt],
  );

  return result.rows[0];
}

async function markPullRequestTested(pool, prNumber, testedBy) {
  const existingResult = await pool.query(
    `
      SELECT id, pr_number, status, tested_at, tested_by
      FROM pull_requests
      WHERE pr_number = $1
      ORDER BY merged_at DESC
      LIMIT 1
    `,
    [prNumber],
  );

  if (existingResult.rows.length === 0) {
    return { found: false };
  }

  const existing = existingResult.rows[0];
  if (existing.status === "tested") {
    return {
      found: true,
      alreadyTested: true,
      pullRequest: existing,
    };
  }

  const updatedResult = await pool.query(
    `
      UPDATE pull_requests
      SET status = 'tested',
          tested_at = NOW(),
          tested_by = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, pr_number, status, tested_at, tested_by
    `,
    [existing.id, testedBy || null],
  );

  return {
    found: true,
    alreadyTested: false,
    pullRequest: updatedResult.rows[0],
  };
}

async function insertDeployment(pool, deployment) {
  const result = await pool.query(
    `
      INSERT INTO deployments (environment, provider, external_deploy_id, deployed_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, environment, provider, external_deploy_id, deployed_at
    `,
    [deployment.environment, deployment.provider, deployment.externalDeployId || null],
  );

  return result.rows[0];
}

async function markPullRequestsDeployedSince(pool, lastDeployAt, deployedAt) {
  const result = await pool.query(
    `
      UPDATE pull_requests
      SET status = 'deployed',
          deployed_at = $2,
          updated_at = NOW()
      WHERE merged_at > $1
        AND status = 'tested'
      RETURNING id
    `,
    [lastDeployAt, deployedAt],
  );

  return result.rowCount;
}

module.exports = {
  createPool,
  getLastProdDeployAt,
  insertDeployment,
  listBlockingPullRequests,
  markPullRequestsDeployedSince,
  markPullRequestTested,
  runMigrations,
  upsertPullRequestAsUntested,
  verifyConnection,
};
