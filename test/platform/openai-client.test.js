const assert = require("node:assert/strict");
const test = require("node:test");

const { createOpenAiClient } = require("../../src/platform/ai/providers/openai/client");

test("createOpenAiClient returns null when required config is missing", () => {
  assert.equal(createOpenAiClient({ config: {} }), null);
  assert.equal(
    createOpenAiClient({
      config: {
        aiOpenAiApiKey: "openai-key",
        aiOpenAiModel: "",
      },
    }),
    null,
  );
});

test("createOpenAiClient sends chat completions request and returns generated text", async () => {
  const requests = [];
  const client = createOpenAiClient({
    config: {
      aiOpenAiApiKey: "openai-key",
      aiOpenAiModel: "gpt-4.1-mini",
      aiOpenAiBaseUrl: "https://openai.example.com/v1",
      aiTimeoutSeconds: 15,
    },
    fetchFn: async (requestUrl, options = {}) => {
      requests.push({ options, url: String(requestUrl) });
      return buildResponse({
        body: {
          choices: [
            {
              message: {
                content: "Draft body",
              },
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
  assert.equal(requests[0].url, "https://openai.example.com/v1/chat/completions");
  assert.equal(requests[0].options.headers.Authorization, "Bearer openai-key");
  const requestBody = JSON.parse(requests[0].options.body);
  assert.equal(requestBody.model, "gpt-4.1-mini");
  assert.equal(requestBody.temperature, 0.1);
  assert.deepEqual(requestBody.messages, [
    { role: "system", content: "System prompt" },
    { role: "user", content: "User prompt" },
  ]);
});

test("createOpenAiClient surfaces API failures", async () => {
  const client = createOpenAiClient({
    config: {
      aiOpenAiApiKey: "openai-key",
      aiOpenAiModel: "gpt-4.1-mini",
      aiOpenAiBaseUrl: "https://openai.example.com/v1",
    },
    fetchFn: async () => {
      return buildResponse({
        body: {
          error: {
            message: "upstream failed",
          },
        },
        ok: false,
        status: 500,
      });
    },
  });

  await assert.rejects(async () => {
    await client.generateText({
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
    });
  }, /OpenAI API request failed \(500\)/);
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
