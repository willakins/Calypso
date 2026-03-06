const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const {
  normalizeEmailText,
  stripHtmlToText,
} = require("../../../../shared/email_text");

function createOutlookClient({ config, fetchFn = fetch } = {}) {
  const mailboxAddress = String(config?.emailOutlookAddress || "").trim().toLowerCase();
  const tenantId = String(config?.emailOutlookTenantId || "").trim();
  const clientId = String(config?.emailOutlookClientId || "").trim();
  const clientSecret = String(config?.emailOutlookClientSecret || "").trim();

  if (!mailboxAddress || !tenantId || !clientId || !clientSecret) {
    return null;
  }

  let accessToken = null;
  let accessTokenExpiresAt = 0;

  return {
    mailboxAddress,
    provider: "outlook",
    async getMessageMetadata(messageId) {
      return graphRequestJson(`/users/${encodeURIComponent(mailboxAddress)}/messages/${encodeURIComponent(messageId)}`, {
        query: [
          ["$select", "id,conversationId,receivedDateTime,subject,from"],
        ],
      });
    },
    async getMessageDetail(messageId) {
      const message = await graphRequestJson(
        `/users/${encodeURIComponent(mailboxAddress)}/messages/${encodeURIComponent(messageId)}`,
        {
          headers: {
            Prefer: 'outlook.body-content-type="text"',
          },
          query: [
            ["$select", "id,conversationId,receivedDateTime,subject,from,body,bodyPreview"],
          ],
        },
      );

      return {
        fromAddress: String(message?.from?.emailAddress?.address || "").trim().toLowerCase() || null,
        id: String(message?.id || "").trim() || null,
        plainTextBody: readMessageBody(message),
        provider: "outlook",
        receivedAt: normalizeTimestamp(message?.receivedDateTime),
        subject: String(message?.subject || "").trim() || null,
        threadId: String(message?.conversationId || "").trim() || null,
      };
    },
    async listRecentInboxMessages({ afterTimestamp }) {
      const messages = [];
      let nextLink = null;
      const normalizedAfterTimestamp = normalizeTimestamp(afterTimestamp);

      do {
        const response = await graphRequestJson(
          nextLink || `/users/${encodeURIComponent(mailboxAddress)}/mailFolders/inbox/messages`,
          {
            absoluteUrl: Boolean(nextLink),
            query: nextLink
              ? []
              : [
                  ["$select", "id,conversationId,receivedDateTime,subject,from"],
                  ["$orderby", "receivedDateTime asc"],
                  ["$top", "100"],
                  ...(normalizedAfterTimestamp
                    ? [["$filter", `receivedDateTime ge ${normalizedAfterTimestamp}`]]
                    : []),
                ],
          },
        );

        messages.push(...(Array.isArray(response.value) ? response.value : []));
        nextLink = String(response["@odata.nextLink"] || "").trim() || null;
      } while (nextLink);

      return messages.map((message) => ({
        id: String(message?.id || "").trim(),
      })).filter((message) => message.id);
    },
  };

  async function ensureAccessToken() {
    const now = Date.now();
    if (accessToken && accessTokenExpiresAt - 60_000 > now) {
      return accessToken;
    }

    const tokenResponse = await fetchFn(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
      },
    );

    const tokenBodyText = await tokenResponse.text();
    const tokenBody = parseJsonSafely(tokenBodyText);
    if (!tokenResponse.ok) {
      throw buildOutlookApiError({
        body: tokenBody,
        bodyText: tokenBodyText,
        message: "Failed to refresh Outlook access token.",
        status: tokenResponse.status,
      });
    }

    accessToken = String(tokenBody?.access_token || "").trim();
    const expiresInSeconds = Number(tokenBody?.expires_in || 3600);
    accessTokenExpiresAt = now + Math.max(1, expiresInSeconds) * 1000;
    if (!accessToken) {
      throw new Error("Failed to refresh Outlook access token: missing access_token.");
    }

    return accessToken;
  }

  async function graphRequestJson(pathOrUrl, { absoluteUrl = false, headers = {}, query = [] } = {}) {
    const bearerToken = await ensureAccessToken();
    const requestUrl = absoluteUrl
      ? new URL(pathOrUrl)
      : new URL(`${DEFAULT_GRAPH_BASE_URL}${pathOrUrl}`);
    for (const [name, value] of query) {
      if (value !== null && value !== undefined && value !== "") {
        requestUrl.searchParams.append(name, String(value));
      }
    }

    const response = await fetchFn(requestUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        ...headers,
      },
    });

    const responseText = await response.text();
    const responseBody = parseJsonSafely(responseText);
    if (!response.ok) {
      throw buildOutlookApiError({
        body: responseBody,
        bodyText: responseText,
        message: `Outlook API request failed for ${requestUrl.pathname}.`,
        status: response.status,
      });
    }

    return responseBody || {};
  }
}

function buildOutlookApiError({ body, bodyText, message, status }) {
  const detail =
    String(body?.error?.message || "").trim() ||
    String(body?.message || "").trim() ||
    bodyText ||
    "unknown error";
  const error = new Error(`${message} ${status}: ${detail}`);
  error.body = body || null;
  error.status = status;
  return error;
}

function normalizeTimestamp(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  const parsedDate = new Date(normalizedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString();
}

function readMessageBody(message) {
  const rawBodyContent = String(message?.body?.content || "");
  const htmlFallback = containsHtmlMarkup(rawBodyContent)
    ? stripHtmlToText(rawBodyContent)
    : null;
  const textBody = htmlFallback ? null : normalizeEmailText(rawBodyContent);
  if (textBody) {
    return textBody;
  }

  if (htmlFallback) {
    return normalizeEmailText(htmlFallback);
  }

  return normalizeEmailText(message?.bodyPreview || "");
}

function containsHtmlMarkup(value) {
  return /<[^>]+>/.test(String(value || ""));
}

function parseJsonSafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  createOutlookClient,
};
