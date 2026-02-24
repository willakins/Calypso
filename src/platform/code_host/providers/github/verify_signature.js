const crypto = require("node:crypto");

function verifyGithubSignature({ payloadBuffer, signatureHeader, secret }) {
  if (!secret) {
    return false;
  }

  const normalizedSignatureHeader = String(signatureHeader || "").trim();
  if (!normalizedSignatureHeader.startsWith("sha256=")) {
    return false;
  }

  const normalizedPayloadBuffer = normalizePayloadBuffer(payloadBuffer);
  if (!normalizedPayloadBuffer) {
    return false;
  }

  const expectedSignature = createSignature(normalizedPayloadBuffer, secret);
  const actualSignature = normalizedSignatureHeader;

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(actualSignature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function createSignature(payloadBuffer, secret) {
  const digest = crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex");
  return `sha256=${digest}`;
}

function normalizePayloadBuffer(payloadBuffer) {
  if (Buffer.isBuffer(payloadBuffer)) {
    return payloadBuffer;
  }

  if (typeof payloadBuffer === "string") {
    return Buffer.from(payloadBuffer, "utf8");
  }

  if (payloadBuffer instanceof ArrayBuffer) {
    return Buffer.from(payloadBuffer);
  }

  if (ArrayBuffer.isView(payloadBuffer)) {
    return Buffer.from(payloadBuffer.buffer, payloadBuffer.byteOffset, payloadBuffer.byteLength);
  }

  return null;
}

module.exports = {
  verifyGithubSignature,
};
