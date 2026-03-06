const assert = require("node:assert/strict");
const test = require("node:test");

const { createAnthropicClient } = require("../../src/platform/ai/providers/anthropic/client");

test("createAnthropicClient returns null when required config is missing", () => {
  assert.equal(createAnthropicClient({ config: {} }), null);
  assert.equal(
    createAnthropicClient({
      config: {
        aiAnthropicApiKey: "anthropic-key",
        aiAnthropicModel: "",
      },
    }),
    null,
  );
});

test("createAnthropicClient sends messages request and returns generated text", async () => {
  const requests = [];
  const client = createAnthropicClient({
    config: {
      aiAnthropicApiKey: "anthropic-key",
      aiAnthropicModel: "claude-3-7-sonnet",
      aiAnthropicBaseUrl: "https://anthropic.example.com",
      aiTimeoutSeconds: 15,
    },
    fetchFn: async (requestUrl, options = {}) => {
      requests.push({ options, url: String(requestUrl) });
      return buildResponse({
        body: {
          content: [
            {
              type: "text",
              text: "Draft body",
            },
          ],
        },
      });
    },
  });

  const generatedText = await client.generateText({
    systemPrompt: "System prompt",
    userPrompt: "User prompt",
    temperature: 0.1,
  });

  assert.equal(generatedText, "Draft body");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://anthropic.example.com/v1/messages");
  assert.equal(requests[0].options.headers["x-api-key"], "anthropic-key");
  assert.equal(requests[0].options.headers["anthropic-version"], "2023-06-01");
  const requestBody = JSON.parse(requests[0].options.body);
  assert.equal(requestBody.model, "claude-3-7-sonnet");
  assert.equal(requestBody.temperature, 0.1);
  assert.equal(requestBody.system, "System prompt");
  assert.deepEqual(requestBody.messages, [
    { role: "user", content: "User prompt" },
  ]);
});

test("createAnthropicClient surfaces API failures", async () => {
  const client = createAnthropicClient({
    config: {
      aiAnthropicApiKey: "anthropic-key",
      aiAnthropicModel: "claude-3-7-sonnet",
      aiAnthropicBaseUrl: "https://anthropic.example.com",
    },
    fetchFn: async () => {
      return buildResponse({
        body: {
          error: {
            message: "upstream failed",
          },
        },
        ok: false,
        status: 503,
      });
    },
  });

  await assert.rejects(async () => {
    await client.generateText({
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
    });
  }, /Anthropic API request failed \(503\)/);
});

function buildResponse({ body, headers = {}, ok = true, status = 200 }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}
