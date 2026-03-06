const assert = require("node:assert/strict");
const test = require("node:test");

const { handleCalypsoCommand, registerCalypsoCommand } = require("../../src/commands/command_router");

test("handleCalypsoCommand routes emails list input", () => {
  const result = handleCalypsoCommand({ text: "emails", user_id: "U123" });

  assert.equal(result.action, "emails_list");
});

test("handleCalypsoCommand routes emails responded input", () => {
  const result = handleCalypsoCommand({ text: "emails responded 42", user_id: "U123" });

  assert.equal(result.action, "emails_responded");
  assert.equal(result.emailId, 42);
});

test("handleCalypsoCommand routes environment status config input", () => {
  const result = handleCalypsoCommand({ text: "config environment-status:on", user_id: "UADMIN" });

  assert.equal(result.action, "config_environment_status");
  assert.equal(result.enabled, true);
});

test("handleCalypsoCommand routes environment status url config input", () => {
  const result = handleCalypsoCommand({
    text: "config environment-status-url:https://example.com/healthz",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_environment_status_url");
  assert.equal(result.targetUrl, "https://example.com/healthz");
});

test("handleCalypsoCommand routes email monitor config input", () => {
  const result = handleCalypsoCommand({ text: "config email-monitor:on", user_id: "UADMIN" });

  assert.equal(result.action, "config_email_monitor");
  assert.equal(result.enabled, true);
});

test("handleCalypsoCommand routes email channel config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-channel:<#C123ABC|support>",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_channel");
  assert.equal(result.targetChannelReference, "<#C123ABC|support>");
});

test("handleCalypsoCommand routes email on call config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call <@U123ABC> 1D",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_on_call");
  assert.equal(result.targetUserId, "U123ABC");
  assert.equal(result.onCallDurationToken, "1d");
});

test("handleCalypsoCommand routes email on call off config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call off",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_on_call_off");
});

test("handleCalypsoCommand rejects invalid email on call duration", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call <@U123ABC> 0D",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\/calypso config email-on-call <@USER\|USER_ID> <Nh\|Nd\|Nw>/);
});

test("registerCalypsoCommand emails command lists pending support emails", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      listPendingSupportEmailThreadsFn: async () => [
        {
          id: 42,
          first_sender: "alice@example.com",
          subject: "Billing question",
        },
      ],
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Pending customer support emails:/);
  assert.match(payload.text, /\[42\] alice@example.com \| Billing question/);
});

test("registerCalypsoCommand emails command marks support email responded", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      markSupportEmailThreadRespondedFn: async (_pool, emailId, respondedBy) => {
        calls.push({ emailId, respondedBy });
        return { found: true, alreadyResponded: false, emailThread: { id: emailId } };
      },
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails responded 7", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, [{ emailId: 7, respondedBy: "U123" }]);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Marked support email \[7\] as responded/);
});

test("registerCalypsoCommand config command updates environment status monitoring", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setEnvironmentStatusEnabledFn: async (_pool, enabled, updatedBy) => {
        calls.push({ enabled, updatedBy });
        return {};
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config environment-status:on", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, [{ enabled: true, updatedBy: "UADMIN" }]);
  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated environment status monitoring to `on`/);
});

test("registerCalypsoCommand config command rejects invalid environment status url ephemerally", async () => {
  let commandHandler;
  let setCalled = false;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setEnvironmentStatusUrlFn: async () => {
        setCalled = true;
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config environment-status-url:ftp://example.com", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(setCalled, false);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Environment status URL `ftp:\/\/example.com` is invalid/);
});

test("registerCalypsoCommand config command updates support email on call", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setSupportEmailOnCallFn: async (_pool, targetUserId, expiresAt, updatedBy) => {
        calls.push({ targetUserId, expiresAt, updatedBy });
        return {};
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config email-on-call <@U555> 1D", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetUserId, "U555");
  assert.equal(calls[0].updatedBy, "UADMIN");
  assert.ok(calls[0].expiresAt);
  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated support email on-call to <@U555> for `1d`/);
});

test("registerCalypsoCommand config command clears support email on call", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      clearSupportEmailOnCallFn: async (_pool, updatedBy) => {
        calls.push(updatedBy);
        return {};
      },
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config email-on-call off", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, ["UADMIN"]);
  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Cleared support email on-call assignment/);
});

test("registerCalypsoCommand config command reports unresolved support email on call handle", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setSupportEmailOnCallFn: async () => {
        throw new Error("should not be called");
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    client: {
      users: {
        list: async () => ({
          members: [],
          response_metadata: {},
        }),
      },
    },
    command: { text: "config email-on-call @ghost 1d", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Could not resolve `@ghost` to a Slack user/);
});
