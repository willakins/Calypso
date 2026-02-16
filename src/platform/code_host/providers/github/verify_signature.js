const crypto = require("node:crypto");

function verifyGithubSignature({ payloadBuffer, signatureHeader, secret }) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = createSignature(payloadBuffer, secret);
  const actualSignature = signatureHeader;

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

module.exports = {
  verifyGithubSignature,
};
