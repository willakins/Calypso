const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const INITIAL_MIGRATION_PATH = path.join(__dirname, "migrations", "001_init.sql");
const EPOCH_UTC_TIMESTAMP_SQL = "TIMESTAMPTZ '1970-01-01 00:00:00+00'";
const TLS_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

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
  const migrationSql = fs.readFileSync(INITIAL_MIGRATION_PATH, "utf8");
  await pool.query(migrationSql);
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
