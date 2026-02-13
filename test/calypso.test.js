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
});

test("handleCalypsoCommand routes status input", () => {
  const result = handleCalypsoCommand({ text: "status", user_id: "U123" });

  assert.equal(result.action, "status");
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
  assert.match(result.responseText, /Usage: `\/calypso config time-format:human`/);
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

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Force deploy triggered/);
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
  assert.match(responses[0].text, /Deploy triggered \(id: dep-abc\)/);
  assert.match(
    responses[1].text,
    /DigitalOcean deployment dep-abc finished successfully with phase ACTIVE/,
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

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Deploy triggered/);
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
  assert.match(payload.text, /Updated time format to `long`/);
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
