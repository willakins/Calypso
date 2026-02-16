const assert = require("node:assert/strict");
const test = require("node:test");

const { handleCalypsoCommand, registerCalypsoCommand } = require("../src/commands/calypso");

test("handleCalypsoCommand returns help for empty input", () => {
  const result = handleCalypsoCommand({ text: "", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Calypso/);
  assert.match(result.responseText, /\/calypso help/);
});

test("handleCalypsoCommand returns help for help input", () => {
  const result = handleCalypsoCommand({ text: "HeLp", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\/calypso help/);
  assert.match(result.responseText, /\/calypso sync/);
  assert.match(result.responseText, /Help Topics/);
  assert.match(result.responseText, /\/calypso help testing/);
  assert.match(result.responseText, /\/calypso help reviewing/);
  assert.match(result.responseText, /\/calypso help config/);
});

test("handleCalypsoCommand uses configured bot name in help header", () => {
  const result = handleCalypsoCommand({ text: "help", user_id: "U123", botName: "Voyager" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /^\*Voyager\*/);
});

test("handleCalypsoCommand returns testing topic help", () => {
  const result = handleCalypsoCommand({ text: "help testing", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Testing Help\*/);
  assert.match(result.responseText, /\/calypso tested <PR_NUMBER>/);
  assert.match(result.responseText, /\/calypso deploy prod force/);
});

test("handleCalypsoCommand returns reviewing topic help", () => {
  const result = handleCalypsoCommand({ text: "help reviewing", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Reviewing Help\*/);
  assert.match(result.responseText, /\/calypso reviews <GITHUB_USER>/);
  assert.match(result.responseText, /Defaults: `1w`, `mon@09:00`, `America\/New_York`/);
});

test("handleCalypsoCommand returns config topic help", () => {
  const result = handleCalypsoCommand({ text: "help config", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Config Help\*/);
  assert.match(result.responseText, /\/calypso config time-format:human\|long/);
  assert.match(result.responseText, /\/calypso config communication-provider:slack\|microsoft_teams/);
  assert.match(result.responseText, /\/calypso config review-recap-schedule:<weekday>@HH:MM/);
});

test("handleCalypsoCommand rejects unknown help topic", () => {
  const result = handleCalypsoCommand({ text: "help foobar", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /\/calypso help testing/);
});

test("handleCalypsoCommand routes status input", () => {
  const result = handleCalypsoCommand({ text: "status", user_id: "U123" });

  assert.equal(result.action, "status");
});

test("handleCalypsoCommand routes sync input", () => {
  const result = handleCalypsoCommand({ text: "sync", user_id: "U123" });

  assert.equal(result.action, "sync_open_pr_review_state");
});

test("handleCalypsoCommand rejects invalid sync input", () => {
  const result = handleCalypsoCommand({ text: "sync now", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage: `\/calypso sync`/);
});

test("handleCalypsoCommand routes reviews input", () => {
  const result = handleCalypsoCommand({ text: "reviews", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.timeframe, null);
  assert.equal(result.githubUser, null);
});

test("handleCalypsoCommand routes reviews input with github user", () => {
  const result = handleCalypsoCommand({ text: "reviews octocat", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, "octocat");
  assert.equal(result.timeframe, null);
});

test("handleCalypsoCommand routes reviews input with timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews week", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, null);
  assert.equal(result.timeframe, "week");
});

test("handleCalypsoCommand routes reviews input with recent timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews recent day", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, null);
  assert.equal(result.timeframe, "day");
});

test("handleCalypsoCommand routes reviews input with github user and timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews octocat month", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, "octocat");
  assert.equal(result.timeframe, "month");
});

test("handleCalypsoCommand rejects invalid reviews input", () => {
  const result = handleCalypsoCommand({ text: "reviews recent", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /`\/calypso reviews`/);
});

test("handleCalypsoCommand routes tested input with PR number", () => {
  const result = handleCalypsoCommand({ text: "tested 42", user_id: "U123" });

  assert.equal(result.action, "tested_single");
  assert.equal(result.prNumber, 42);
});

test("handleCalypsoCommand routes tested all input", () => {
  const result = handleCalypsoCommand({ text: "tested all", user_id: "U123" });

  assert.equal(result.action, "tested_all");
});

test("handleCalypsoCommand routes tested recent input", () => {
  const result = handleCalypsoCommand({ text: "tested recent week", user_id: "U123" });

  assert.equal(result.action, "tested_recent");
  assert.equal(result.timeframe, "week");
});

test("handleCalypsoCommand rejects tested input without PR number", () => {
  const result = handleCalypsoCommand({ text: "tested", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
});

test("handleCalypsoCommand routes deploy prod input", () => {
  const result = handleCalypsoCommand({ text: "deploy prod", user_id: "U123" });

  assert.equal(result.action, "deploy_prod");
});

test("handleCalypsoCommand routes deploy prod force input", () => {
  const result = handleCalypsoCommand({ text: "deploy prod force", user_id: "U123" });

  assert.equal(result.action, "deploy_prod");
  assert.equal(result.forceDeployment, true);
});

test("handleCalypsoCommand rejects invalid deploy input", () => {
  const result = handleCalypsoCommand({ text: "deploy", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage: `\/calypso deploy prod`/);
});

test("handleCalypsoCommand routes whitelist command with mention", () => {
  const result = handleCalypsoCommand({ text: "whitelist <@U123ABC>", user_id: "UADMIN" });

  assert.equal(result.action, "whitelist_add");
  assert.equal(result.targetUserId, "U123ABC");
});

test("handleCalypsoCommand routes config time-format input", () => {
  const result = handleCalypsoCommand({ text: "config time-format:long", user_id: "UADMIN" });

  assert.equal(result.action, "config_time_format");
  assert.equal(result.timeFormat, "long");
});

test("handleCalypsoCommand rejects invalid config input", () => {
  const result = handleCalypsoCommand({ text: "config time-format:weird", user_id: "UADMIN" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /`\/calypso config time-format:human`/);
  assert.match(result.responseText, /`\/calypso config timezone:America\/New_York`/);
});

test("handleCalypsoCommand routes config timezone input", () => {
  const result = handleCalypsoCommand({
    text: "config timezone:America/Los_Angeles",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_timezone");
  assert.equal(result.timeZone, "America/Los_Angeles");
});

test("handleCalypsoCommand routes config review recap channel input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-channel:<#C123ABC|deploys>",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_channel");
  assert.equal(result.targetChannelId, "C123ABC");
});

test("handleCalypsoCommand routes config review recap recency input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-recency:2w",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_recency");
  assert.equal(result.recencyValue, 2);
  assert.equal(result.recencyUnit, "w");
});

test("handleCalypsoCommand routes config review recap schedule input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-schedule:tue@10:15",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_schedule");
  assert.equal(result.scheduleWeekday, "tue");
  assert.equal(result.scheduleTime, "10:15");
});

test("handleCalypsoCommand routes config communication provider input", () => {
  const result = handleCalypsoCommand({
    text: "config communication-provider:slack",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_communication_provider");
  assert.equal(result.communicationProvider, "slack");
});

test("handleCalypsoCommand routes config code-host provider input", () => {
  const result = handleCalypsoCommand({
    text: "config code-host-provider:github",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_code_host_provider");
  assert.equal(result.codeHostProvider, "github");
});

test("handleCalypsoCommand routes config deploy provider input", () => {
  const result = handleCalypsoCommand({
    text: "config deploy-provider:digitalocean",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_deploy_provider");
  assert.equal(result.deployProvider, "digitalocean");
});

test("handleCalypsoCommand returns unknown message for unsupported input", () => {
  const result = handleCalypsoCommand({ text: "foobar", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Unknown subcommand\./);
  assert.doesNotMatch(result.responseText, /foobar/);
});

test("handleCalypsoCommand sanitizes control characters before parsing", () => {
  const result = handleCalypsoCommand({ text: "\u0000\nstatus\t", user_id: "U123" });

  assert.equal(result.action, "status");
});

test("handleCalypsoCommand rejects tested command with injection-like payload", () => {
  const result = handleCalypsoCommand({
    text: "tested \"/'DATABASE DROP\"",
    user_id: "U123",
  });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
});

test("registerCalypsoCommand registers /calypso and responds ephemerally", async () => {
  let commandName;
  let commandHandler;

  const app = {
    command(name, handler) {
      commandName = name;
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app);

  assert.equal(commandName, "/calypso");
  assert.equal(typeof commandHandler, "function");

  let ackCalled = false;
  let payload;

  await commandHandler({
    command: { text: "help", user_id: "U123" },
    ack: async () => {
      ackCalled = true;
    },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(ackCalled, true);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /\/calypso help/);
  assert.match(payload.text, /\/calypso sync/);
  assert.match(payload.text, /Help Topics/);
  assert.match(payload.text, /\/calypso help reviewing/);
});

test("registerCalypsoCommand runs sync command and returns summary", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    runOpenPullRequestSyncNowFn: async () => ({
      upsertedCount: 7,
      closedCount: 2,
      mergedUntestedCount: 3,
    }),
  });

  let payload;
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Open PR sync completed successfully/);
  assert.match(payload.text, /Review sync: upserted 7 open PR\(s\)/);
  assert.match(payload.text, /marked 2 stale PR\(s\) closed/);
  assert.match(payload.text, /Untested merge sync: upserted 3 merged untested PR\(s\)/);
});

test("registerCalypsoCommand reports sync unavailable when token is not configured", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  let payload;
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Sync unavailable/);
  assert.match(payload.text, /CODE_HOST_TOKEN/);
});

test("registerCalypsoCommand returns sync failure details when manual sync throws", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    runOpenPullRequestSyncNowFn: async () => {
      throw new Error("github rate limited");
    },
  });

  let payload;
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Open PR sync failed/);
  assert.match(payload.text, /github rate limited/);
});

test("registerCalypsoCommand denies sync for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
    runOpenPullRequestSyncNowFn: async () => ({
      upsertedCount: 1,
      closedCount: 0,
    }),
  });

  let payload;
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Sync denied/);
  assert.match(payload.text, /Only workspace admins or whitelisted users can run manual sync/);
});

test("registerCalypsoCommand handles status with injected db functions", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    getLastProdDeployAtFn: async () => "2026-02-13T22:00:17.000Z",
    listBlockingPullRequestsFn: async () => [],
    readTimeFormatPreferenceFn: async () => "long",
  });

  let payload;

  await commandHandler({
    command: { text: "status", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /No blockers since last prod deploy/);
  assert.match(payload.text, /2026-02-13 22:00:17 UTC/);
});

test("registerCalypsoCommand shows open waiting reviews without filters", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 55,
        title: "Add observability",
        author_login: "octocat",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
    ],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Open PRs waiting on review:/);
  assert.match(payload.text, /croft-eng\/croft#55 - Add observability/);
  assert.match(payload.text, /created by octocat/);
  assert.match(payload.text, /opened for review on February 13th, 2026 at 5:00 PM EST/);
});

test("registerCalypsoCommand filters waiting reviews by github user", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 11,
        title: "One",
        author_login: "octocat",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Two",
        author_login: "hubot",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
    ],
    readTimeFormatPreferenceFn: async () => "long",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews octocat", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /for github user octocat/);
  assert.match(payload.text, /croft-eng\/croft#11 - One/);
  assert.doesNotMatch(payload.text, /croft-eng\/croft#12 - Two/);
});

test("registerCalypsoCommand shows no-results message for reviews timeframe filter", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews week", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /No open PRs waiting on review in the last week/);
});

test("registerCalypsoCommand reports not found for tested command", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markPullRequestTestedFn: async () => ({ found: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 9999", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /PR #9999 not found/);
});

test("registerCalypsoCommand is idempotent for already tested PR", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markPullRequestTestedFn: async () => ({ found: true, alreadyTested: true }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 77", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /already marked tested/);
});

test("registerCalypsoCommand denies tested single for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 77", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Tested update denied/);
});

test("registerCalypsoCommand marks all untested PRs as tested", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markAllUntestedPullRequestsTestedFn: async () => 3,
  });

  let payload;
  await commandHandler({
    command: { text: "tested all", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Marked 3 untested PR\(s\) as tested/);
});

test("registerCalypsoCommand denies tested all for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested all", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Tested update denied/);
});

test("registerCalypsoCommand shows recently tested PRs for tested recent", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listRecentlyTestedPullRequestsFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 123,
        status: "tested",
        tested_at: "2026-02-13T20:00:00.000Z",
        tested_by: "U123",
        title: "Patch release fix",
      },
    ],
  });

  let payload;
  await commandHandler({
    command: { text: "tested recent day", user_id: "U123" },
    client: {
      users: {
        info: async () => ({
          user: {
            profile: {
              display_name: "Willa",
            },
          },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /PRs tested in the last day/);
  assert.match(payload.text, /#123/);
  assert.match(payload.text, /tested by Willa on February 13th, 2026 at 3:00 PM EST/);
});

test("registerCalypsoCommand blocks deploy when blockers exist", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [{ repo: "croft-eng/croft", pr_number: 12, status: "untested" }],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Deploy blocked due to untested PRs/);
});

test("registerCalypsoCommand denies deploy for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Deploy denied/);
  assert.match(payload.text, /Only workspace admins or whitelisted users can deploy/);
});

test("registerCalypsoCommand force deploy bypasses blockers", async () => {
  let commandHandler;
  const queryCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [{ repo: "croft-eng/croft", pr_number: 12, status: "untested" }],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    insertDeploymentFn: async () => ({ deployed_at: "2026-02-13T17:00:00.000Z" }),
    markPullRequestsDeployedSinceFn: async () => 0,
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod force", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Force deploy to prod is in progress/);
  assert.match(payload.text, /Bypassed 1 blocking PR\(s\)/);
  assert.deepEqual(queryCalls, ["BEGIN", "COMMIT"]);
});

test("registerCalypsoCommand sends deployment completion follow-up when enabled", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-abc" }),
    insertDeploymentFn: async () => ({ deployed_at: "2026-02-13T17:00:00.000Z" }),
    markPullRequestsDeployedSinceFn: async () => 2,
    waitForProdDeployCompletionFn: async () => ({ id: "dep-abc", phase: "ACTIVE" }),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
      doDeploymentPollIntervalMs: 1,
      doDeploymentTimeoutMs: 1000,
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[0].response_type, "in_channel");
  assert.match(responses[0].text, /Deploy to prod is in progress \(id: dep-abc\)/);
  assert.equal(responses[1].response_type, "in_channel");
  assert.match(
    responses[1].text,
    /Deployment dep-abc finished successfully with phase ACTIVE/,
  );
});

test("registerCalypsoCommand returns deploy not configured when clear", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /deploy not configured/i);
});

test("registerCalypsoCommand triggers deploy and records deployment when clear and configured", async () => {
  let commandHandler;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    insertDeploymentFn: async () => ({ deployed_at: "2026-02-13T17:00:00.000Z" }),
    markPullRequestsDeployedSinceFn: async () => 2,
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Deploy to prod is in progress/);
  assert.match(payload.text, /Marked 2 PR\(s\) deployed/);
  assert.deepEqual(queryCalls, ["BEGIN", "COMMIT"]);
});

test("registerCalypsoCommand does not mutate DB when deploy call fails", async () => {
  let commandHandler;
  let inserted = false;
  let marked = false;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    triggerProdDeployFn: async () => {
      throw new Error("deploy failed");
    },
    insertDeploymentFn: async () => {
      inserted = true;
    },
    markPullRequestsDeployedSinceFn: async () => {
      marked = true;
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(inserted, false);
  assert.equal(marked, false);
  assert.deepEqual(queryCalls, []);
  assert.match(payload.text, /Deploy failed before deployment state was committed/);
});

test("registerCalypsoCommand reports rollback when deployment state transaction fails", async () => {
  let commandHandler;
  let marked = false;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    insertDeploymentFn: async () => {
      throw new Error("insert failed");
    },
    markPullRequestsDeployedSinceFn: async () => {
      marked = true;
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(marked, false);
  assert.deepEqual(queryCalls, ["BEGIN", "ROLLBACK"]);
  assert.match(payload.text, /Transaction was rolled back/);
});

test("registerCalypsoCommand whitelist command denies non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U999>", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Only workspace admins or whitelisted users can manage deploy whitelist/);
});

test("registerCalypsoCommand whitelist command adds user for admin", async () => {
  let commandHandler;
  const captured = {};

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async (_pool, targetUserId, addedBy) => {
      captured.targetUserId = targetUserId;
      captured.addedBy = addedBy;
      return { added: true };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U999>", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(captured.targetUserId, "U999");
  assert.equal(captured.addedBy, "UADMIN");
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Added <@U999> to deploy whitelist/);
});

test("registerCalypsoCommand whitelist command adds user for whitelisted caller", async () => {
  let commandHandler;
  const captured = {};

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "deploy_whitelist" }),
    isWorkspaceAdminFn: async () => false,
    addUserToDeployWhitelistFn: async (_pool, targetUserId, addedBy) => {
      captured.targetUserId = targetUserId;
      captured.addedBy = addedBy;
      return { added: true };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U777>", user_id: "UWHITELISTED" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(captured.targetUserId, "U777");
  assert.equal(captured.addedBy, "UWHITELISTED");
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Added <@U777> to deploy whitelist/);
});

test("registerCalypsoCommand config command updates time format", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredTimeFormatFn: async (pool, timeFormat, updatedBy) => {
      capturedCalls.push({ pool, timeFormat, updatedBy });
      return { time_format: timeFormat, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config time-format:long", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated your time format to `long`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].timeFormat, "long");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command denies non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "config time-format:human", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Config update denied/);
});

test("registerCalypsoCommand config command updates timezone when valid", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    isValidTimeZoneFn: () => true,
    setConfiguredTimeZoneFn: async (pool, timeZone, updatedBy) => {
      capturedCalls.push({ type: "user", pool, timeZone, updatedBy });
      return { timezone: timeZone, updated_by: updatedBy };
    },
    setReviewRecapTimeZoneFn: async (pool, timeZone, updatedBy) => {
      capturedCalls.push({ type: "recap", pool, timeZone, updatedBy });
      return { timezone: timeZone, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config timezone:America/Los_Angeles", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Timezone `America\/Los_Angeles` is valid/);
  assert.match(payload.text, /Updated timezone for human timestamps and review recap schedule/);
  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[0].timeZone, "America/Los_Angeles");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
  assert.equal(capturedCalls[1].timeZone, "America/Los_Angeles");
  assert.equal(capturedCalls[1].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command reports invalid timezone", async () => {
  let commandHandler;
  let setTimezoneCalled = false;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    isValidTimeZoneFn: () => false,
    setConfiguredTimeZoneFn: async () => {
      setTimezoneCalled = true;
      return {};
    },
    setReviewRecapTimeZoneFn: async () => {
      setTimezoneCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config timezone:Mars/Olympus", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Timezone `Mars\/Olympus` is invalid/);
  assert.equal(setTimezoneCalled, false);
});

test("registerCalypsoCommand config command updates review recap channel", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async (pool, targetChannelId, updatedBy) => {
      capturedCalls.push({ pool, targetChannelId, updatedBy });
      return { target_channel_id: targetChannelId, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:<#C999ABC|deploys>", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated review recap channel to <#C999ABC>/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].targetChannelId, "C999ABC");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap recency", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapRecencyFn: async (pool, recencyValue, recencyUnit, updatedBy) => {
      capturedCalls.push({ pool, recencyValue, recencyUnit, updatedBy });
      return { recency_value: recencyValue, recency_unit: recencyUnit, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-recency:2w", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated review recap recency to `2w`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].recencyValue, 2);
  assert.equal(capturedCalls[0].recencyUnit, "w");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap schedule", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapScheduleFn: async (pool, scheduleWeekday, scheduleTime, updatedBy) => {
      capturedCalls.push({ pool, scheduleWeekday, scheduleTime, updatedBy });
      return { schedule_weekday: scheduleWeekday, schedule_time: scheduleTime, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-schedule:tue@10:15", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated review recap schedule to `tue@10:15`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].scheduleWeekday, "tue");
  assert.equal(capturedCalls[0].scheduleTime, "10:15");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates communication provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCommunicationProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { communication_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config communication-provider:slack", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated communication provider to `slack`/);
  assert.match(payload.text, /Restart Calypso for this change to take effect/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "slack");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates code-host provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCodeHostProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { code_host_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config code-host-provider:github", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated code-host provider to `github`/);
  assert.match(payload.text, /Restart Calypso for this change to take effect/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "github");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates deploy provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredDeployProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { deploy_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config deploy-provider:digitalocean", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated deploy provider to `digitalocean`/);
  assert.match(payload.text, /Restart Calypso for this change to take effect/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "digitalocean");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates microsoft teams provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCommunicationProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { communication_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config communication-provider:microsoft_teams", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated communication provider to `microsoft_teams`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "microsoft_teams");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates bitbucket code-host provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCodeHostProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { code_host_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config code-host-provider:bitbucket", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated code-host provider to `bitbucket`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "bitbucket");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates aws deploy provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredDeployProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { deploy_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config deploy-provider:aws", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated deploy provider to `aws`/);
  assert.match(payload.text, /Restart Calypso for this change to take effect/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "aws");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});
