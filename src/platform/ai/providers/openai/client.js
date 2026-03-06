const { buildRequestUrl, fetchJsonWithTimeout } = require("../shared/client_common");

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 800;

function createOpenAiClient({ config, fetchFn = fetch } = {}) {
  const apiKey = String(config?.aiOpenAiApiKey || "").trim();
  const model = String(config?.aiOpenAiModel || "").trim();
  const baseUrl = String(config?.aiOpenAiBaseUrl || DEFAULT_OPENAI_BASE_URL).trim();
  const timeoutMs = resolveTimeoutMs(config?.aiTimeoutSeconds);

  if (!apiKey || !model) {
    return null;
  }

  return {
    model,
    provider: "openai",
    async generateText({ systemPrompt, userPrompt, temperature = DEFAULT_TEMPERATURE }) {
      const requestUrl = buildRequestUrl(baseUrl, "chat/completions");
      const responseBody = await fetchJsonWithTimeout({
        fetchFn,
        providerName: "OpenAI",
        requestUrl,
        requestOptions: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: buildMessages({ systemPrompt, userPrompt }),
            temperature,
            max_tokens: DEFAULT_MAX_TOKENS,
          }),
        },
        timeoutMs,
      });

      const generatedText = readGeneratedText(responseBody);
      if (!generatedText) {
        throw new Error("OpenAI API response did not include generated text.");
      }

      return generatedText;
    },
  };
}

function buildMessages({ systemPrompt, userPrompt }) {
  const messages = [];
  if (String(systemPrompt || "").trim() !== "") {
    messages.push({
      role: "system",
      content: String(systemPrompt).trim(),
    });
  }

  messages.push({
    role: "user",
    content: String(userPrompt || "").trim(),
  });

  return messages;
}

function readGeneratedText(responseBody) {
  const content = responseBody?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const normalizedText = content.trim();
    return normalizedText === "" ? null : normalizedText;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const normalizedText = content
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return normalizedText === "" ? null : normalizedText;
}

function resolveTimeoutMs(timeoutSeconds) {
  const parsedTimeoutSeconds = Number(timeoutSeconds || 30);
  if (!Number.isFinite(parsedTimeoutSeconds) || parsedTimeoutSeconds <= 0) {
    return 30_000;
  }

  return Math.max(1, Math.floor(parsedTimeoutSeconds * 1000));
}

module.exports = {
  createOpenAiClient,
};
