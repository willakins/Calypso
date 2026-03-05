const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEPLOY_PROD_TIP_TEXT,
} = require("../../src/platform/communication/deploy_prod_tip");
const {
  SlackCommunicationPlatform,
} = require("../../src/platform/communication/providers/slack_communication_platform");

test("slack platform posts deploy prod tip ephemerally for matching messages", async () => {
  const postEphemeralCalls = [];
  const messageHandlers = [];
  const fakeApp = createFakeSlackApp({
    postEphemeral: async (payload) => {
      postEphemeralCalls.push(payload);
    },
    registerMessageHandler(handler) {
      messageHandlers.push(handler);
    },
  });

  new SlackCommunicationPlatform({
    app: fakeApp,
    config: {},
  });

  assert.equal(messageHandlers.length, 1);

  await messageHandlers[0]({
    client: fakeApp.client,
    message: {
      channel: "C123",
      text: " Deploying   prod! ",
      user: "U123",
    },
  });

  assert.deepEqual(postEphemeralCalls, [
    {
      channel: "C123",
      text: DEPLOY_PROD_TIP_TEXT,
      user: "U123",
    },
  ]);
});

test("slack platform ignores non-matching or bot deploy prod tip messages", async () => {
  const postEphemeralCalls = [];
  const messageHandlers = [];
  const fakeApp = createFakeSlackApp({
    postEphemeral: async (payload) => {
      postEphemeralCalls.push(payload);
    },
    registerMessageHandler(handler) {
      messageHandlers.push(handler);
    },
  });

  new SlackCommunicationPlatform({
    app: fakeApp,
    config: {},
  });

  const handler = messageHandlers[0];
  await handler({
    client: fakeApp.client,
    message: {
      channel: "C123",
      text: "deploy prod",
      user: "U123",
    },
  });
  await handler({
    client: fakeApp.client,
    message: {
      bot_id: "B123",
      channel: "C123",
      text: "deploying prod",
      user: "U123",
    },
  });

  assert.deepEqual(postEphemeralCalls, []);
});

function createFakeSlackApp({ postEphemeral, registerMessageHandler }) {
  return {
    client: {
      chat: {
        postEphemeral,
        postMessage: async () => {},
      },
      users: {
        info: async () => ({ user: {} }),
      },
    },
    command() {
      return;
    },
    message(handler) {
      registerMessageHandler(handler);
    },
    start: async () => {},
  };
}
