const crypto = require("node:crypto");
const express = require("express");

const GOOGLE_OAUTH_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const ALLOWED_GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const certificateCache = {
  certsByKid: null,
  expiresAt: 0,
};

function registerGmailWebhook(httpApp, options = {}) {
  const path = options.path || "/email/webhook";
  const handler = createGmailWebhookHandler(options);

  httpApp.post(path, express.json({ type: "application/json" }), handler);
}

function createGmailWebhookHandler(options = {}) {
  const {
    config = {},
    pool,
    upsertPendingSupportEmailHistoryIdFn,
    verifyPushJwtFn = verifyGooglePubsubPushJwt,
  } = options;

  const gmailAddress = String(config.emailGmailAddress || "").trim().toLowerCase();
  const expectedAudience = String(config.emailWebhookAudience || "").trim();
  const expectedServiceAccountEmail = String(config.emailPushServiceAccountEmail || "").trim();

  return async (request, response) => {
    try {
      const verification = await verifyPushJwtFn({
        expectedAudience,
        expectedServiceAccountEmail,
        request,
      });
      if (!verification.valid) {
        return response.status(401).json({ ok: false, error: "invalid bearer token" });
      }

      const notificationPayload = decodePubsubMessage(request.body?.message?.data);
      if (!notificationPayload) {
        return response.status(400).json({ ok: false, error: "invalid pubsub payload" });
      }

      const notificationEmail = String(notificationPayload.emailAddress || "").trim().toLowerCase();
      const historyId = normalizeHistoryId(notificationPayload.historyId);
      if (!notificationEmail || !historyId) {
        return response.status(400).json({ ok: false, error: "invalid gmail notification payload" });
      }

      if (!gmailAddress || notificationEmail !== gmailAddress) {
        return response.status(200).json({ ok: true, ignored: true });
      }

      const pendingHistoryId = await upsertPendingSupportEmailHistoryIdFn(pool, historyId);
      return response.status(200).json({
        ok: true,
        pendingHistoryId,
      });
    } catch (error) {
      console.error("Failed to process Gmail webhook.");
      console.error(error.message);
      return response.status(500).json({ ok: false, error: "internal error" });
    }
  };
}

async function verifyGooglePubsubPushJwt({
  expectedAudience,
  expectedServiceAccountEmail,
  fetchFn = fetch,
  request,
}) {
  const bearerToken = readBearerToken(request);
  if (!bearerToken) {
    return { valid: false, reason: "missing_bearer_token" };
  }

  const decodedToken = decodeJwt(bearerToken);
  if (!decodedToken || decodedToken.header?.alg !== "RS256" || !decodedToken.header?.kid) {
    return { valid: false, reason: "invalid_jwt" };
  }

  const certsByKid = await fetchGoogleOauthCertificates(fetchFn);
  const certificate = certsByKid[decodedToken.header.kid];
  if (!certificate) {
    return { valid: false, reason: "unknown_kid" };
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(decodedToken.signedContent);
  verifier.end();
  const signatureIsValid = verifier.verify(certificate, decodedToken.signature);
  if (!signatureIsValid) {
    return { valid: false, reason: "invalid_signature" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = String(decodedToken.payload?.iss || "").trim();
  const audience = String(decodedToken.payload?.aud || "").trim();
  const email = String(decodedToken.payload?.email || "").trim();
  const emailVerified = decodedToken.payload?.email_verified;
  const expiresAt = Number(decodedToken.payload?.exp || 0);
  if (!ALLOWED_GOOGLE_ISSUERS.has(issuer)) {
    return { valid: false, reason: "invalid_issuer" };
  }
  if (expectedAudience && audience !== expectedAudience) {
    return { valid: false, reason: "invalid_audience" };
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    return { valid: false, reason: "expired_token" };
  }
  if (expectedServiceAccountEmail && email !== expectedServiceAccountEmail) {
    return { valid: false, reason: "invalid_service_account" };
  }
  if (email && emailVerified === false) {
    return { valid: false, reason: "email_not_verified" };
  }

  return {
    valid: true,
    payload: decodedToken.payload,
  };
}

async function fetchGoogleOauthCertificates(fetchFn) {
  const now = Date.now();
  if (certificateCache.certsByKid && certificateCache.expiresAt > now) {
    return certificateCache.certsByKid;
  }

  const response = await fetchFn(GOOGLE_OAUTH_CERTS_URL);
  const responseText = await response.text();
  const responseBody = parseJsonSafely(responseText);
  if (!response.ok || !responseBody || typeof responseBody !== "object") {
    throw new Error("Failed to load Google OAuth certificates.");
  }

  const cacheControlHeader = String(response.headers?.get?.("cache-control") || "").trim();
  const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 300;
  certificateCache.certsByKid = responseBody;
  certificateCache.expiresAt = now + Math.max(1, maxAgeSeconds) * 1000;
  return certificateCache.certsByKid;
}

function readBearerToken(request) {
  const authorizationHeader = String(
    request?.headers?.authorization ||
      request?.get?.("authorization") ||
      "",
  ).trim();
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function decodePubsubMessage(encodedData) {
  const normalizedEncodedData = String(encodedData || "").trim();
  if (!normalizedEncodedData) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(normalizedEncodedData, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function decodeJwt(token) {
  const tokenParts = String(token || "").split(".");
  if (tokenParts.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = tokenParts;
  const header = parseJsonSafely(base64UrlToBuffer(headerEncoded).toString("utf8"));
  const payload = parseJsonSafely(base64UrlToBuffer(payloadEncoded).toString("utf8"));
  if (!header || !payload) {
    return null;
  }

  return {
    header,
    payload,
    signature: base64UrlToBuffer(signatureEncoded),
    signedContent: `${headerEncoded}.${payloadEncoded}`,
  };
}

function base64UrlToBuffer(value) {
  const normalizedValue = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalizedValue.length % 4)) % 4;
  const padding = "=".repeat(paddingLength);
  return Buffer.from(`${normalizedValue}${padding}`, "base64");
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

module.exports = {
  createGmailWebhookHandler,
  registerGmailWebhook,
  verifyGooglePubsubPushJwt,
};
