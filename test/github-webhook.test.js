const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createGithubWebhookHandler } = require("../src/integrations/github/webhook");
const { verifyGithubSignature } = require("../src/integrations/github/verify_signature");

function signPayload(secret, payloadBuffer) {
  return `sha256=${crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex")}`;
}

function buildReqRes({ payload, signature, event = "pull_request" }) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
    "x-github-event": event,
    "x-hub-signature-256": signature,
  };

  const req = {
    body,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };

  const res = {
    body: null,
    statusCode: 200,
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };

  return { req, res, body };
}

test("verifyGithubSignature validates a correct sha256 signature", () => {
  const secret = "test-secret";
  const payloadBuffer = Buffer.from('{"ok":true}', "utf8");
  const signatureHeader = signPayload(secret, payloadBuffer);

  const valid = verifyGithubSignature({ payloadBuffer, signatureHeader, secret });
  assert.equal(valid, true);
});

test("github webhook returns 401 on invalid signature", async () => {
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "correct-secret",
    },
  });
  const payload = { action: "closed" };
  const { req, res } = buildReqRes({
    payload,
    signature: "sha256=not-valid",
  });

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("github webhook upserts merged main PR as untested", async () => {
  let savedPullRequest;
  const handler = createGithubWebhookHandler({
    pool: { marker: "pool" },
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertPullRequestAsUntestedFn: async (_pool, pr) => {
      savedPullRequest = pr;
      return { pr_number: pr.prNumber, status: "untested" };
    },
  });
  const payload = {
    action: "closed",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 77,
      merged: true,
      merged_at: "2026-02-13T17:00:00Z",
      title: "Ship it",
      html_url: "https://github.com/croft-eng/croft/pull/77",
      base: { ref: "main" },
    },
  };
  const { req, res, body } = buildReqRes({
    payload,
    signature: signPayload("secret", Buffer.from(JSON.stringify(payload), "utf8")),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(savedPullRequest.repo, "croft-eng/croft");
  assert.equal(savedPullRequest.prNumber, 77);
  assert.equal(savedPullRequest.mergedAt, "2026-02-13T17:00:00Z");
});
