const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";

function createGmailClient({ config, fetchFn = fetch } = {}) {
  const gmailAddress = String(config?.emailGmailAddress || "").trim().toLowerCase();
  const clientId = String(config?.emailGmailClientId || "").trim();
  const clientSecret = String(config?.emailGmailClientSecret || "").trim();
  const refreshToken = String(config?.emailGmailRefreshToken || "").trim();
  const pubsubTopic = String(config?.emailGmailPubsubTopic || "").trim();

  if (!gmailAddress || !clientId || !clientSecret || !refreshToken || !pubsubTopic) {
    return null;
  }

  let accessToken = null;
  let accessTokenExpiresAt = 0;

  return {
    gmailAddress,
    async getMessageMetadata(messageId) {
      return gmailRequestJson(`/messages/${encodeURIComponent(messageId)}`, {
        query: [
          ["format", "metadata"],
          ["metadataHeaders", "From"],
          ["metadataHeaders", "Subject"],
          ["metadataHeaders", "Date"],
        ],
      });
    },
    async listHistory({ startHistoryId }) {
      const history = [];
      let nextPageToken = null;
      let latestHistoryId = normalizeHistoryId(startHistoryId);

      do {
        const response = await gmailRequestJson("/history", {
          query: [
            ["historyTypes", "messageAdded"],
            ["labelId", "INBOX"],
            ["maxResults", "100"],
            ["startHistoryId", startHistoryId],
            ...(nextPageToken ? [["pageToken", nextPageToken]] : []),
          ],
        });

        history.push(...(Array.isArray(response.history) ? response.history : []));
        nextPageToken = String(response.nextPageToken || "").trim() || null;
        latestHistoryId = normalizeHistoryId(response.historyId) || latestHistoryId;
      } while (nextPageToken);

      return {
        history,
        historyId: latestHistoryId,
      };
    },
    async listRecentInboxMessages({ afterTimestamp }) {
      const messages = [];
      let nextPageToken = null;
      const afterSeconds = Math.floor(new Date(afterTimestamp).getTime() / 1000);

      do {
        const response = await gmailRequestJson("/messages", {
          query: [
            ["includeSpamTrash", "false"],
            ["labelIds", "INBOX"],
            ["maxResults", "100"],
            ["q", `after:${afterSeconds}`],
            ...(nextPageToken ? [["pageToken", nextPageToken]] : []),
          ],
        });

        messages.push(...(Array.isArray(response.messages) ? response.messages : []));
        nextPageToken = String(response.nextPageToken || "").trim() || null;
      } while (nextPageToken);

      return messages;
    },
    async watchMailbox() {
      const response = await gmailRequestJson("/watch", {
        method: "POST",
        body: {
          labelFilterAction: "include",
          labelIds: ["INBOX"],
          topicName: pubsubTopic,
        },
      });

      return {
        expiration: normalizeTimestampMillis(response.expiration),
        historyId: normalizeHistoryId(response.historyId),
      };
    },
  };

  async function ensureAccessToken() {
    const now = Date.now();
    if (accessToken && accessTokenExpiresAt - 60_000 > now) {
      return accessToken;
    }

    const tokenResponse = await fetchFn(DEFAULT_GMAIL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    const tokenBodyText = await tokenResponse.text();
    const tokenBody = parseJsonSafely(tokenBodyText);
    if (!tokenResponse.ok) {
      throw buildGmailApiError({
        body: tokenBody,
        bodyText: tokenBodyText,
        message: "Failed to refresh Gmail access token.",
        status: tokenResponse.status,
      });
    }

    accessToken = String(tokenBody?.access_token || "").trim();
    const expiresInSeconds = Number(tokenBody?.expires_in || 3600);
    accessTokenExpiresAt = now + Math.max(1, expiresInSeconds) * 1000;
    if (!accessToken) {
      throw new Error("Failed to refresh Gmail access token: missing access_token.");
    }

    return accessToken;
  }

  async function gmailRequestJson(path, { method = "GET", query = [], body = null } = {}) {
    const bearerToken = await ensureAccessToken();
    const requestUrl = new URL(`${DEFAULT_GMAIL_API_BASE_URL}${path}`);
    for (const [name, value] of query) {
      if (value !== null && value !== undefined && value !== "") {
        requestUrl.searchParams.append(name, String(value));
      }
    }

    const response = await fetchFn(requestUrl, {
      method,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    const responseBody = parseJsonSafely(responseText);
    if (!response.ok) {
      throw buildGmailApiError({
        body: responseBody,
        bodyText: responseText,
        message: `Gmail API request failed for ${requestUrl.pathname}.`,
        status: response.status,
      });
    }

    return responseBody || {};
  }
}

function buildGmailApiError({ body, bodyText, message, status }) {
  const errorMessageFromBody =
    String(body?.error?.message || body?.message || "").trim() || bodyText || "unknown error";
  const error = new Error(`${message} ${status}: ${errorMessageFromBody}`);
  error.body = body || null;
  error.status = status;
  return error;
}

function parseJsonSafely(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return null;
  }
}

function normalizeHistoryId(value) {
  const normalizedValue = String(value || "").trim();
  return /^\d+$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeTimestampMillis(value) {
  const normalizedValue = String(value || "").trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const milliseconds = Number(normalizedValue);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }

  return new Date(milliseconds).toISOString();
}

module.exports = {
  createGmailClient,
};
