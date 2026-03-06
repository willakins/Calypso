const { buildRequestUrl, fetchJsonWithTimeout } = require("../shared/client_common");

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 800;
const ANTHROPIC_VERSION = "2023-06-01";

function createAnthropicClient({ config, fetchFn = fetch } = {}) {
  const apiKey = String(config?.aiAnthropicApiKey || "").trim();
  const model = String(config?.aiAnthropicModel || "").trim();
  const baseUrl = String(config?.aiAnthropicBaseUrl || DEFAULT_ANTHROPIC_BASE_URL).trim();
  const timeoutMs = resolveTimeoutMs(config?.aiTimeoutSeconds);

  if (!apiKey || !model) {
    return null;
  }

  return {
    model,
    provider: "anthropic",
    async generateText({ systemPrompt, userPrompt, temperature = DEFAULT_TEMPERATURE }) {
      const requestUrl = buildRequestUrl(baseUrl, "v1/messages");
      const responseBody = await fetchJsonWithTimeout({
        fetchFn,
        providerName: "Anthropic",
        requestUrl,
        requestOptions: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: DEFAULT_MAX_TOKENS,
            temperature,
            system: String(systemPrompt || "").trim(),
            messages: [
              {
                role: "user",
                content: String(userPrompt || "").trim(),
              },
            ],
          }),
        },
        timeoutMs,
      });

      const generatedText = readGeneratedText(responseBody);
      if (!generatedText) {
        throw new Error("Anthropic API response did not include generated text.");
      }

      return generatedText;
    },
  };
}

function readGeneratedText(responseBody) {
  const generatedText = (responseBody?.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return generatedText === "" ? null : generatedText;
}

function resolveTimeoutMs(timeoutSeconds) {
  const parsedTimeoutSeconds = Number(timeoutSeconds || 30);
  if (!Number.isFinite(parsedTimeoutSeconds) || parsedTimeoutSeconds <= 0) {
    return 30_000;
  }

  return Math.max(1, Math.floor(parsedTimeoutSeconds * 1000));
}

module.exports = {
  createAnthropicClient,
};
