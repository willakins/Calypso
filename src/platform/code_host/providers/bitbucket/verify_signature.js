const crypto = require("node:crypto");

function verifyBitbucketSignature({ payloadBuffer, signatureHeader, secret }) {
  if (!secret) {
    return false;
  }

  const normalizedSignatureHeader = String(signatureHeader || "").trim();
  if (normalizedSignatureHeader === "") {
    return false;
  }

  const expectedWithPrefix = createSha256Signature(payloadBuffer, secret, { withPrefix: true });
  if (timingSafeEquals(expectedWithPrefix, normalizedSignatureHeader)) {
    return true;
  }

  const expectedWithoutPrefix = createSha256Signature(payloadBuffer, secret, { withPrefix: false });
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

module.exports = {
  verifyBitbucketSignature,
};
