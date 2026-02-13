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

  assert.equal(result.action, "tested");
  assert.equal(result.prNumber, 42);
});

test("handleCalypsoCommand rejects tested input without PR number", () => {
  const result = handleCalypsoCommand({ text: "tested", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage: `\/calypso tested <PR_NUMBER>`/);
});

test("handleCalypsoCommand routes deploy prod input", () => {
  const result = handleCalypsoCommand({ text: "deploy prod", user_id: "U123" });

  assert.equal(result.action, "deploy_prod");
});

test("handleCalypsoCommand rejects invalid deploy input", () => {
  const result = handleCalypsoCommand({ text: "deploy", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage: `\/calypso deploy prod`/);
});

test("handleCalypsoCommand returns unknown message for unsupported input", () => {
  const result = handleCalypsoCommand({ text: "foobar", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Unknown subcommand: `foobar`/);
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
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
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

test("registerCalypsoCommand blocks deploy when blockers exist", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
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

test("registerCalypsoCommand returns deploy not configured when clear", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
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
  assert.match(payload.text, /Calypso hit an error/);
});
