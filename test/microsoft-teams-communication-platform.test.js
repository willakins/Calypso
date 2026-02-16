const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MicrosoftTeamsCommunicationPlatform,
} = require("../src/platform/communication/providers/microsoft_teams_communication_platform");

test("microsoft teams platform registers command route and responds", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Calypso",
      communicationAdminUserIds: ["UADMIN"],
    },
  });

  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  const app = {
    post(path, handler) {
      routes.push({ path, handler });
    },
  };

  platform.registerHttpRoutes(app);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/communication/commands");

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/calypso help",
        from: {
          id: "U123",
          name: "will.akins",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.text, /\/calypso help/);
  assert.equal(await platform.resolveUserDisplayName("U123"), "will.akins");
  assert.equal(await platform.isWorkspaceAdmin("UADMIN"), true);
  assert.equal(await platform.isWorkspaceAdmin("UNAUTHORIZED"), false);
});

test("microsoft teams platform returns 400 for missing command text", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {},
  });
  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {},
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.text, /Missing command text/);
});

test("microsoft teams platform strips configured bot prefix", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Voyager",
    },
  });
  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/voyager help",
        from: {
          id: "U123",
          name: "will.akins",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.text, /\*Voyager\*/);
});

test("microsoft teams platform posts channel message via webhook", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      text: async () => "",
    };
  };

  try {
    const platform = new MicrosoftTeamsCommunicationPlatform({
      config: {
        communicationWebhookUrl: "https://example.test/teams/webhook",
      },
    });

    await platform.postChannelMessage({
      channelId: "ignored",
      mrkdwn: true,
      text: "recap message",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/teams/webhook");
    assert.equal(calls[0].options.method, "POST");
    assert.match(calls[0].options.body, /recap message/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("microsoft teams platform rejects posting when webhook URL is missing", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {},
  });

  await assert.rejects(
    async () => {
      await platform.postChannelMessage({
        text: "hello",
      });
    },
    /webhook URL is not configured/,
  );
});

function createResponseRecorder() {
  return {
    payload: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}
