const DEFAULT_ROLLBAR_API_BASE_URL = "https://api.rollbar.com";

function createRollbarClient({
  accessToken,
  baseUrl = DEFAULT_ROLLBAR_API_BASE_URL,
  fetchFn = fetch,
} = {}) {
  const normalizedAccessToken = String(accessToken || "").trim();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!normalizedAccessToken || !normalizedBaseUrl) {
    return null;
  }

  return {
    provider: "rollbar",

    async listUnresolvedIssues({ environment = null, projectSlug, timeoutMs = 15_000 } = {}) {
      const normalizedProjectSlug = normalizeProjectSlug(projectSlug);
      if (!normalizedProjectSlug) {
        throw new Error("Rollbar project is required.");
      }

      const issues = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const requestUrl = buildItemsRequestUrl({
          baseUrl: normalizedBaseUrl,
          environment,
          page,
          projectSlug: normalizedProjectSlug,
        });
        const body = await rollbarRequestJson({
          accessToken: normalizedAccessToken,
          fetchFn,
          requestUrl,
          timeoutMs,
        });

        const pageItems = extractResultItems(body);
        for (const item of pageItems) {
          issues.push(mapRollbarItem(item, {
            defaultEnvironment: normalizeEnvironment(environment),
            defaultProjectSlug: normalizedProjectSlug,
          }));
        }

        const totalPages = readTotalPages(body);
        if (totalPages !== null) {
          hasMore = page < totalPages;
        } else {
          hasMore = pageItems.length === 100;
        }
        page += 1;
      }

      return issues;
    },
  };
}

async function rollbarRequestJson({ accessToken, fetchFn, requestUrl, timeoutMs }) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Rollbar-Access-Token": accessToken,
      },
      signal: abortController.signal,
    });
    const responseText = await response.text();
    const responseBody = parseJsonSafely(responseText);
    if (!response.ok) {
      throw buildRollbarApiError({
        body: responseBody,
        bodyText: responseText,
        requestUrl,
        status: response.status,
      });
    }

    return responseBody || {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Rollbar API request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRollbarApiError({ body, bodyText, requestUrl, status }) {
  const detail =
    normalizeOptionalText(body?.message) ||
    normalizeOptionalText(body?.result?.message) ||
    normalizeOptionalText(bodyText) ||
    "unknown error";
  return new Error(`Rollbar API request failed (${status}) for ${requestUrl}: ${detail}`);
}

function buildItemsRequestUrl({ baseUrl, environment, page, projectSlug }) {
  const requestUrl = new URL("/api/1/items/", baseUrl);
  requestUrl.searchParams.set("page", String(page));
  requestUrl.searchParams.set("status", "active");

  const normalizedEnvironment = normalizeEnvironment(environment);
  if (normalizedEnvironment) {
    requestUrl.searchParams.set("environment", normalizedEnvironment);
  }

  if (/^\d+$/.test(projectSlug)) {
    requestUrl.searchParams.set("project_id", projectSlug);
  }

  return requestUrl;
}

function extractResultItems(body) {
  if (Array.isArray(body)) {
    return body;
  }
  if (Array.isArray(body?.result?.items)) {
    return body.result.items;
  }
  if (Array.isArray(body?.result)) {
    return body.result;
  }

  return [];
}

function readTotalPages(body) {
  const candidates = [
    body?.result?.total_pages,
    body?.result?.pages,
  ];
  for (const candidate of candidates) {
    const parsedCandidate = Number(candidate);
    if (Number.isInteger(parsedCandidate) && parsedCandidate > 0) {
      return parsedCandidate;
    }
  }

  return null;
}

function mapRollbarItem(item, { defaultEnvironment = null, defaultProjectSlug = null } = {}) {
  const firstSeenAt =
    normalizeTimestamp(
      item?.first_occurrence_timestamp ||
      item?.first_occurrence?.timestamp ||
      item?.first_seen_at,
    ) || new Date().toISOString();
  const lastSeenAt =
    normalizeTimestamp(
      item?.last_occurrence_timestamp ||
      item?.last_occurrence?.timestamp ||
      item?.last_seen_at,
    ) || firstSeenAt;

  return {
    culprit:
      normalizeOptionalText(item?.last_occurrence?.body?.trace?.exception?.class) ||
      normalizeOptionalText(item?.last_occurrence?.body?.message?.body),
    environment:
      normalizeEnvironment(item?.last_occurrence?.environment) ||
      defaultEnvironment,
    eventCount:
      normalizeIssueCount(item?.total_occurrences) ||
      normalizeIssueCount(item?.occurrence_count),
    externalIssueId: normalizeOptionalText(item?.id),
    firstSeenAt,
    lastSeenAt,
    level:
      normalizeOptionalText(item?.level) ||
      normalizeOptionalText(item?.last_occurrence?.level) ||
      "error",
    permalink:
      normalizeOptionalText(item?.permalink) ||
      normalizeOptionalText(item?.url) ||
      normalizeOptionalText(item?.item_url),
    projectSlug:
      normalizeProjectSlug(item?.project?.slug) ||
      normalizeProjectSlug(item?.project_name) ||
      defaultProjectSlug,
    shortId:
      normalizeOptionalText(item?.counter) ||
      normalizeOptionalText(item?.id),
    title:
      normalizeOptionalText(item?.title) ||
      normalizeOptionalText(item?.last_occurrence?.title) ||
      "(untitled)",
  };
}

function normalizeIssueCount(value) {
  const normalizedValue = Number(value);
  return Number.isInteger(normalizedValue) && normalizedValue >= 0 ? normalizedValue : 0;
}

function normalizeBaseUrl(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch (_error) {
    return null;
  }
}

function normalizeProjectSlug(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeEnvironment(value) {
  const normalizedValue = normalizeOptionalText(value);
  return normalizedValue || null;
}

function normalizeOptionalText(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeTimestamp(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  const normalizedTimestamp = /^\d+$/.test(normalizedValue)
    ? new Date(Number(normalizedValue) * 1000)
    : new Date(normalizedValue);
  if (Number.isNaN(normalizedTimestamp.getTime())) {
    return null;
  }

  return normalizedTimestamp.toISOString();
}

function parseJsonSafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  createRollbarClient,
};
