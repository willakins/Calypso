const crypto = require("node:crypto");

function verifyBitbucketSignature({ payloadBuffer, signatureHeader, secret }) {
  if (!secret) {
    return false;
  }

  const normalizedPayloadBuffer = normalizePayloadBuffer(payloadBuffer);
  if (!normalizedPayloadBuffer) {
    return false;
  }

  const normalizedSignatureHeader = String(signatureHeader || "").trim();
  if (normalizedSignatureHeader === "") {
    return false;
  }

  const expectedWithPrefix = createSha256Signature(normalizedPayloadBuffer, secret, { withPrefix: true });
  if (timingSafeEquals(expectedWithPrefix, normalizedSignatureHeader)) {
    return true;
  }

  const expectedWithoutPrefix = createSha256Signature(normalizedPayloadBuffer, secret, {
    withPrefix: false,
  });
  return timingSafeEquals(expectedWithoutPrefix, normalizedSignatureHeader);
}

function createSha256Signature(payloadBuffer, secret, { withPrefix }) {
  const digest = crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex");
  return withPrefix ? `sha256=${digest}` : digest;
}

function timingSafeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
  verifyBitbucketSignature,
};
