function buildRequestUrl(baseUrl, requestPath) {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  if (normalizedBaseUrl === "") {
    throw new Error("AI provider base URL is required.");
  }

  return new URL(
    String(requestPath || "").replace(/^\/+/, ""),
    normalizedBaseUrl.endsWith("/") ? normalizedBaseUrl : `${normalizedBaseUrl}/`,
  );
}

async function fetchJsonWithTimeout({
  fetchFn,
  providerName,
  requestUrl,
  requestOptions = {},
  timeoutMs,
}) {
  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(requestUrl, {
      ...requestOptions,
      signal: requestOptions.signal || controller.signal,
    });
    const responseText = await response.text();
    const responseBody = parseJsonSafely(responseText);

    if (!response.ok) {
      throw buildApiError({
        providerName,
        requestUrl,
        response,
        responseBody,
        responseText,
      });
    }

    return responseBody || {};
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${providerName} API request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timerId);
  }
}

function buildApiError({ providerName, requestUrl, response, responseBody, responseText }) {
  const detail =
    String(responseBody?.error?.message || "").trim() ||
    String(responseBody?.message || "").trim() ||
    responseText ||
    "unknown error";
  return new Error(
    `${providerName} API request failed (${response.status}) for ${requestUrl}: ${detail}`,
  );
}

function parseJsonSafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

module.exports = {
  buildRequestUrl,
  fetchJsonWithTimeout,
};
