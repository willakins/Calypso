const DEFAULT_EMAIL_TEXT_MAX_LENGTH = 12_000;

function normalizeEmailText(value, options = {}) {
  const maxLength = resolveMaxLength(options.maxLength);
  const normalizedValue = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
  if (normalizedValue.trim() === "") {
    return null;
  }

  const collapsedValue = normalizedValue
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+([,.;!?])/g, "$1")
    .trim();
  if (collapsedValue === "") {
    return null;
  }

  if (collapsedValue.length <= maxLength) {
    return collapsedValue;
  }

  return collapsedValue.slice(0, maxLength).trimEnd();
}

function stripHtmlToText(html) {
  const normalizedHtml = String(html || "").trim();
  if (normalizedHtml === "") {
    return null;
  }

  const textValue = normalizedHtml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|table|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(textValue);
}

function decodeBase64Url(value) {
  const normalizedValue = String(value || "").trim();
  if (normalizedValue === "") {
    return null;
  }

  const paddedValue = normalizedValue
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(normalizedValue.length / 4) * 4, "=");

  return Buffer.from(paddedValue, "base64").toString("utf8");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function resolveMaxLength(value) {
  const parsedValue = Number(value || DEFAULT_EMAIL_TEXT_MAX_LENGTH);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_EMAIL_TEXT_MAX_LENGTH;
  }

  return Math.floor(parsedValue);
}

module.exports = {
  DEFAULT_EMAIL_TEXT_MAX_LENGTH,
  decodeBase64Url,
  normalizeEmailText,
  stripHtmlToText,
};
