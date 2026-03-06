const DEFAULT_SENTRY_API_BASE_URL = "https://sentry.io";

function createSentryClient({
  authToken,
  baseUrl = DEFAULT_SENTRY_API_BASE_URL,
  fetchFn = fetch,
  organizationSlug,
} = {}) {
  const normalizedAuthToken = String(authToken || "").trim();
  const normalizedOrganizationSlug = String(organizationSlug || "").trim();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!normalizedAuthToken || !normalizedOrganizationSlug || !normalizedBaseUrl) {
    return null;
  }

  const projectIdsBySlug = new Map();

  return {
    provider: "sentry",

    async listUnresolvedIssues({ environment = null, projectSlug, timeoutMs = 15_000 } = {}) {
      const normalizedProjectSlug = normalizeProjectSlug(projectSlug);
      if (!normalizedProjectSlug) {
        throw new Error("Sentry project slug is required.");
      }

      const projectId = await resolveProjectId(normalizedProjectSlug, timeoutMs);
      let requestUrl = buildIssuesRequestUrl({
        baseUrl: normalizedBaseUrl,
        environment,
        organizationSlug: normalizedOrganizationSlug,
        projectId,
      });
      const issues = [];

      while (requestUrl) {
        const { body, linkHeader } = await sentryRequestJson({
          authToken: normalizedAuthToken,
          fetchFn,
          requestUrl,
          timeoutMs,
        });

        const pageIssues = Array.isArray(body) ? body : [];
        for (const issue of pageIssues) {
          issues.push(mapSentryIssue(issue, {
            defaultEnvironment: normalizeEnvironment(environment),
            defaultProjectSlug: normalizedProjectSlug,
          }));
        }

        requestUrl = resolveNextPageUrl(linkHeader, normalizedBaseUrl);
      }

      return issues;
    },
  };

  async function resolveProjectId(projectSlug, timeoutMs) {
    if (projectIdsBySlug.has(projectSlug)) {
      return projectIdsBySlug.get(projectSlug);
    }

    let requestUrl = buildProjectsRequestUrl({
      baseUrl: normalizedBaseUrl,
      organizationSlug: normalizedOrganizationSlug,
    });

    while (requestUrl) {
      const { body, linkHeader } = await sentryRequestJson({
        authToken: normalizedAuthToken,
        fetchFn,
        requestUrl,
        timeoutMs,
      });

      const projects = Array.isArray(body) ? body : [];
      for (const project of projects) {
        const normalizedSlug = normalizeProjectSlug(project?.slug);
        const normalizedId = normalizeOptionalText(project?.id);
        if (!normalizedSlug || !normalizedId) {
          continue;
        }

        projectIdsBySlug.set(normalizedSlug, normalizedId);
      }

      if (projectIdsBySlug.has(projectSlug)) {
        return projectIdsBySlug.get(projectSlug);
      }

      requestUrl = resolveNextPageUrl(linkHeader, normalizedBaseUrl);
    }

    throw new Error(
      `Sentry project \`${projectSlug}\` was not found in organization \`${normalizedOrganizationSlug}\`.`,
    );
  }
}

async function sentryRequestJson({ authToken, fetchFn, requestUrl, timeoutMs }) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(requestUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      method: "GET",
      signal: abortController.signal,
    });
    const responseText = await response.text();
    const responseBody = parseJsonSafely(responseText);
    if (!response.ok) {
      throw buildSentryApiError({
        body: responseBody,
        bodyText: responseText,
        requestUrl,
        status: response.status,
      });
    }

    return {
      body: responseBody || [],
      linkHeader: String(response.headers?.get?.("link") || "").trim(),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Sentry API request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSentryApiError({ body, bodyText, requestUrl, status }) {
  const detail =
    normalizeOptionalText(body?.detail) ||
    normalizeOptionalText(body?.error) ||
    normalizeOptionalText(bodyText) ||
    "unknown error";
  return new Error(`Sentry API request failed (${status}) for ${requestUrl}: ${detail}`);
}

function buildProjectsRequestUrl({ baseUrl, organizationSlug }) {
  return new URL(
    `/api/0/organizations/${encodeURIComponent(organizationSlug)}/projects/`,
    baseUrl,
  );
}

function buildIssuesRequestUrl({ baseUrl, environment, organizationSlug, projectId }) {
  const requestUrl = new URL(
    `/api/0/organizations/${encodeURIComponent(organizationSlug)}/issues/`,
    baseUrl,
  );
  requestUrl.searchParams.set("limit", "100");
  requestUrl.searchParams.set("project", String(projectId));
  requestUrl.searchParams.set("query", "is:unresolved");
  requestUrl.searchParams.set("sort", "new");

  const normalizedEnvironment = normalizeEnvironment(environment);
  if (normalizedEnvironment) {
    requestUrl.searchParams.set("environment", normalizedEnvironment);
  }

  return requestUrl;
}

function resolveNextPageUrl(linkHeader, baseUrl) {
  const parsedLinks = parseLinkHeader(linkHeader);
  const nextLink = parsedLinks.next || null;
  if (!nextLink || nextLink.results !== "true" || !nextLink.url) {
    return null;
  }

  return new URL(nextLink.url, baseUrl);
}

function parseLinkHeader(linkHeader) {
  const normalizedHeader = String(linkHeader || "").trim();
  if (!normalizedHeader) {
    return {};
  }

  return normalizedHeader.split(",").reduce((links, rawPart) => {
    const [rawUrlPart, ...rawAttributeParts] = rawPart.trim().split(";");
    const urlMatch = rawUrlPart.match(/^<(.+)>$/);
    if (!urlMatch) {
      return links;
    }

    const attributes = {};
    for (const rawAttributePart of rawAttributeParts) {
      const [rawName, rawValue] = rawAttributePart.trim().split("=");
      if (!rawName || rawValue === undefined) {
        continue;
      }

      attributes[rawName.trim()] = rawValue.trim().replace(/^"|"$/g, "");
    }

    if (attributes.rel) {
      links[attributes.rel] = {
        ...attributes,
        url: urlMatch[1],
      };
    }

    return links;
  }, {});
}

function mapSentryIssue(issue, { defaultEnvironment = null, defaultProjectSlug = null } = {}) {
  const firstSeenAt = normalizeTimestamp(issue?.firstSeen) || new Date().toISOString();
  const lastSeenAt = normalizeTimestamp(issue?.lastSeen) || firstSeenAt;

  return {
    culprit: normalizeOptionalText(issue?.culprit),
    environment: defaultEnvironment,
    eventCount: normalizeIssueCount(issue?.count),
    externalIssueId: normalizeOptionalText(issue?.id),
    firstSeenAt,
    lastSeenAt,
    level: normalizeOptionalText(issue?.level) || "error",
    permalink: normalizeOptionalText(issue?.permalink),
    projectSlug: normalizeProjectSlug(issue?.project?.slug) || defaultProjectSlug,
    shortId: normalizeOptionalText(issue?.shortId),
    title:
      normalizeOptionalText(issue?.title) ||
      normalizeOptionalText(issue?.metadata?.title) ||
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
    const parsedUrl = new URL(normalizedValue);
    return parsedUrl.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeEnvironment(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue || normalizedValue.toLowerCase() === "any") {
    return null;
  }

  return normalizedValue;
}

function normalizeOptionalText(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeProjectSlug(value) {
  return normalizeOptionalText(value);
}

function normalizeTimestamp(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  const timestamp = new Date(normalizedValue);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  createSentryClient,
  mapSentryIssue,
  parseLinkHeader,
};
