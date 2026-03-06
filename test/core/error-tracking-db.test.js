const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getErrorTrackingConfig,
  listOpenErrorTrackingIssues,
  listUnnotifiedErrorTrackingIssues,
  markErrorTrackingIssueNotificationSent,
  setErrorTrackingChannel,
  setErrorTrackingEnvironment,
  setErrorTrackingProject,
  syncErrorTrackingIssueSnapshot,
} = require("../../src/db");

test("error tracking config project and environment changes reset baseline state", async () => {
  const pool = createErrorTrackingPool({
    config: {
      baseline_completed_at: "2026-03-06T10:00:00.000Z",
      enabled: true,
      environment: "staging",
      last_sync_at: "2026-03-06T10:05:00.000Z",
      last_sync_error: "timeout",
      project_slug: "old-api",
      target_channel_id: "COPS",
    },
  });

  await setErrorTrackingProject(pool, "api", "UADMIN");
  const afterProjectUpdate = await getErrorTrackingConfig(pool);
  assert.equal(afterProjectUpdate.projectSlug, "api");
  assert.equal(afterProjectUpdate.baselineCompletedAt, null);
  assert.equal(afterProjectUpdate.lastSyncAt, null);
  assert.equal(afterProjectUpdate.lastSyncError, null);
  assert.equal(afterProjectUpdate.targetChannelId, "COPS");

  await setErrorTrackingEnvironment(pool, "production", "UADMIN");
  const afterEnvironmentUpdate = await getErrorTrackingConfig(pool);
  assert.equal(afterEnvironmentUpdate.environment, "production");
  assert.equal(afterEnvironmentUpdate.baselineCompletedAt, null);
  assert.equal(afterEnvironmentUpdate.lastSyncAt, null);
  assert.equal(afterEnvironmentUpdate.lastSyncError, null);
});

test("error tracking channel updates preserve baseline state", async () => {
  const pool = createErrorTrackingPool({
    config: {
      baseline_completed_at: "2026-03-06T10:00:00.000Z",
      enabled: true,
      environment: "production",
      last_sync_at: "2026-03-06T10:05:00.000Z",
      last_sync_error: null,
      project_slug: "api",
      target_channel_id: "COLD",
    },
  });

  await setErrorTrackingChannel(pool, "CNEW", "UADMIN");
  const config = await getErrorTrackingConfig(pool);

  assert.equal(config.targetChannelId, "CNEW");
  assert.equal(config.baselineCompletedAt, "2026-03-06T10:00:00.000Z");
  assert.equal(config.lastSyncAt, "2026-03-06T10:05:00.000Z");
});

test("syncErrorTrackingIssueSnapshot tracks new issues, resolutions, and regressions", async () => {
  const pool = createErrorTrackingPool();

  await syncErrorTrackingIssueSnapshot(pool, {
    environment: "production",
    issues: [
      {
        eventCount: 2,
        externalIssueId: "7",
        firstSeenAt: "2026-03-06T12:00:00.000Z",
        lastSeenAt: "2026-03-06T12:05:00.000Z",
        level: "error",
        permalink: "https://sentry.example.com/issues/7",
        projectSlug: "api",
        shortId: "API-7",
        title: "Database unavailable",
      },
    ],
    observedAt: "2026-03-06T12:10:00.000Z",
    projectSlug: "api",
    provider: "sentry",
    suppressNotifications: false,
  });

  let pendingIssues = await listUnnotifiedErrorTrackingIssues(pool, {
    environment: "production",
    projectSlug: "api",
    provider: "sentry",
  });
  assert.equal(pendingIssues.length, 1);
  assert.equal(pendingIssues[0].shortId, "API-7");

  await markErrorTrackingIssueNotificationSent(
    pool,
    pendingIssues[0].id,
    "2026-03-06T12:11:00.000Z",
  );
  pendingIssues = await listUnnotifiedErrorTrackingIssues(pool, {
    environment: "production",
    projectSlug: "api",
    provider: "sentry",
  });
  assert.equal(pendingIssues.length, 0);

  await syncErrorTrackingIssueSnapshot(pool, {
    environment: "production",
    issues: [],
    observedAt: "2026-03-06T12:20:00.000Z",
    projectSlug: "api",
    provider: "sentry",
    suppressNotifications: false,
  });
  let openIssues = await listOpenErrorTrackingIssues(pool, {
    environment: "production",
    projectSlug: "api",
    provider: "sentry",
  });
  assert.equal(openIssues.length, 0);

  await syncErrorTrackingIssueSnapshot(pool, {
    environment: "production",
    issues: [
      {
        eventCount: 5,
        externalIssueId: "7",
        firstSeenAt: "2026-03-06T12:00:00.000Z",
        lastSeenAt: "2026-03-06T12:25:00.000Z",
        level: "error",
        permalink: "https://sentry.example.com/issues/7",
        projectSlug: "api",
        shortId: "API-7",
        title: "Database unavailable",
      },
    ],
    observedAt: "2026-03-06T12:30:00.000Z",
    projectSlug: "api",
    provider: "sentry",
    suppressNotifications: false,
  });
  pendingIssues = await listUnnotifiedErrorTrackingIssues(pool, {
    environment: "production",
    projectSlug: "api",
    provider: "sentry",
  });
  openIssues = await listOpenErrorTrackingIssues(pool, {
    environment: "production",
    projectSlug: "api",
    provider: "sentry",
  });

  assert.equal(pendingIssues.length, 1);
  assert.equal(openIssues.length, 1);
  assert.equal(openIssues[0].regressionCount, 1);
  assert.equal(openIssues[0].notificationSentAt, null);
});

function createErrorTrackingPool({ config = {}, issues = [] } = {}) {
  const state = {
    config: {
      enabled: false,
      target_channel_id: null,
      project_slug: null,
      environment: null,
      baseline_completed_at: null,
      last_sync_at: null,
      last_sync_error: null,
      ...config,
    },
    issues: issues.map((issue, index) => ({
      id: index + 1,
      provider: "sentry",
      project_slug: issue.project_slug || "api",
      environment_key: issue.environment_key || "",
      external_issue_id: issue.external_issue_id,
      short_id: issue.short_id || null,
      title: issue.title || "(untitled)",
      culprit: issue.culprit || null,
      level: issue.level || "error",
      permalink: issue.permalink || null,
      event_count: issue.event_count || 0,
      status: issue.status || "unresolved",
      opened_at: issue.opened_at,
      last_seen_at: issue.last_seen_at,
      resolved_at: issue.resolved_at || null,
      regression_count: issue.regression_count || 0,
      notification_sent_at: issue.notification_sent_at || null,
    })),
    nextIssueId: issues.length + 1,
  };

  return {
    async query(sql, params = []) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim();

      if (normalizedSql.includes("FROM error_tracking_config WHERE id = 1")) {
        return { rows: [state.config] };
      }

      if (normalizedSql.startsWith("INSERT INTO error_tracking_config")) {
        const [
          enabled,
          targetChannelId,
          projectSlug,
          environment,
          baselineCompletedAt,
          lastSyncAt,
          lastSyncError,
          _updatedBy,
          clearEnvironment,
          clearBaselineCompletedAt,
          clearLastSyncAt,
          clearLastSyncError,
        ] = params;

        state.config.enabled = enabled ?? state.config.enabled;
        state.config.target_channel_id = targetChannelId ?? state.config.target_channel_id;
        state.config.project_slug = projectSlug ?? state.config.project_slug;
        state.config.environment = clearEnvironment
          ? null
          : environment ?? state.config.environment;
        state.config.baseline_completed_at = clearBaselineCompletedAt
          ? null
          : baselineCompletedAt ?? state.config.baseline_completed_at;
        state.config.last_sync_at = clearLastSyncAt
          ? null
          : lastSyncAt ?? state.config.last_sync_at;
        state.config.last_sync_error = clearLastSyncError
          ? null
          : lastSyncError ?? state.config.last_sync_error;

        return { rows: [state.config] };
      }

      if (
        normalizedSql.startsWith("SELECT id, external_issue_id, status, regression_count FROM error_tracking_issues")
      ) {
        const [provider, projectSlug, environmentKey] = params;
        return {
          rows: state.issues
            .filter((issue) => issue.provider === provider &&
              issue.project_slug === projectSlug &&
              issue.environment_key === environmentKey)
            .map((issue) => ({
              id: issue.id,
              external_issue_id: issue.external_issue_id,
              status: issue.status,
              regression_count: issue.regression_count,
            })),
        };
      }

      if (normalizedSql.startsWith("INSERT INTO error_tracking_issues")) {
        const [
          provider,
          projectSlug,
          environmentKey,
          externalIssueId,
          shortId,
          title,
          culprit,
          level,
          permalink,
          eventCount,
          openedAt,
          lastSeenAt,
          notificationSentAt,
        ] = params;

        state.issues.push({
          id: state.nextIssueId,
          provider,
          project_slug: projectSlug,
          environment_key: environmentKey,
          external_issue_id: externalIssueId,
          short_id: shortId,
          title,
          culprit,
          level,
          permalink,
          event_count: eventCount,
          status: "unresolved",
          opened_at: openedAt,
          last_seen_at: lastSeenAt,
          resolved_at: null,
          regression_count: 0,
          notification_sent_at: notificationSentAt,
        });
        state.nextIssueId += 1;
        return { rows: [] };
      }

      if (normalizedSql.startsWith("UPDATE error_tracking_issues SET short_id =")) {
        const [
          issueId,
          shortId,
          title,
          culprit,
          level,
          permalink,
          eventCount,
          openedAt,
          lastSeenAt,
          regressionCount,
          suppressNotifications,
          observedAt,
          reopenIssue,
        ] = params;
        const issue = state.issues.find((candidate) => candidate.id === issueId);
        issue.short_id = shortId;
        issue.title = title;
        issue.culprit = culprit;
        issue.level = level;
        issue.permalink = permalink;
        issue.event_count = eventCount;
        issue.status = "unresolved";
        issue.opened_at = openedAt;
        issue.last_seen_at = lastSeenAt;
        issue.resolved_at = null;
        issue.regression_count = regressionCount;
        if (suppressNotifications) {
          issue.notification_sent_at = observedAt;
        } else if (reopenIssue) {
          issue.notification_sent_at = null;
        }
        return { rows: [] };
      }

      if (normalizedSql.startsWith("UPDATE error_tracking_issues SET status = 'resolved'")) {
        const [issueId, resolvedAt] = params;
        const issue = state.issues.find((candidate) => candidate.id === issueId);
        issue.status = "resolved";
        issue.resolved_at = resolvedAt;
        return { rows: [] };
      }

      if (normalizedSql.includes("FROM error_tracking_issues") && normalizedSql.includes("notification_sent_at IS NULL")) {
        const [provider, projectSlug, environmentKey] = params;
        return {
          rows: state.issues
            .filter((issue) => issue.provider === provider &&
              issue.project_slug === projectSlug &&
              issue.environment_key === environmentKey &&
              issue.status === "unresolved" &&
              issue.notification_sent_at === null)
            .sort(sortIssues)
            .map(cloneIssueRow),
        };
      }

      if (normalizedSql.includes("FROM error_tracking_issues") && normalizedSql.includes("status = 'unresolved'")) {
        const [provider, projectSlug, environmentKey] = params;
        return {
          rows: state.issues
            .filter((issue) => issue.provider === provider &&
              issue.project_slug === projectSlug &&
              issue.environment_key === environmentKey &&
              issue.status === "unresolved")
            .sort(sortIssues)
            .map(cloneIssueRow),
        };
      }

      if (normalizedSql.startsWith("UPDATE error_tracking_issues SET notification_sent_at = COALESCE")) {
        const [issueId, notificationSentAt] = params;
        const issue = state.issues.find((candidate) => candidate.id === issueId);
        issue.notification_sent_at = notificationSentAt;
        return { rows: [cloneIssueRow(issue)] };
      }

      throw new Error(`Unhandled query in test pool: ${normalizedSql}`);
    },
  };
}

function cloneIssueRow(issue) {
  return {
    id: issue.id,
    provider: issue.provider,
    project_slug: issue.project_slug,
    environment_key: issue.environment_key,
    external_issue_id: issue.external_issue_id,
    short_id: issue.short_id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    permalink: issue.permalink,
    event_count: issue.event_count,
    status: issue.status,
    opened_at: issue.opened_at,
    last_seen_at: issue.last_seen_at,
    resolved_at: issue.resolved_at,
    regression_count: issue.regression_count,
    notification_sent_at: issue.notification_sent_at,
  };
}

function sortIssues(left, right) {
  return (
    right.last_seen_at.localeCompare(left.last_seen_at) ||
    right.opened_at.localeCompare(left.opened_at) ||
    right.id - left.id
  );
}
