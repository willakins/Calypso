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

test("github webhook returns 400 on invalid json payload", async () => {
  const secret = "secret";
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
  });
  const rawBody = Buffer.from("{", "utf8");
  const req = {
    body: rawBody,
    get(name) {
      const key = name.toLowerCase();
      if (key === "x-github-event") {
        return "pull_request";
      }
      if (key === "x-hub-signature-256") {
        return signPayload(secret, rawBody);
      }
      return undefined;
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid json payload");
});

test("github webhook ignores non pull_request events", async () => {
  const secret = "secret";
  let upsertCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    upsertPullRequestAsUntestedFn: async () => {
      upsertCalled = true;
    },
  });
  const payload = { action: "closed" };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "push",
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(upsertCalled, false);
});

test("github webhook ignores merged pull requests outside tracked branch/repo", async () => {
  const secret = "secret";
  let upsertCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    upsertPullRequestAsUntestedFn: async () => {
      upsertCalled = true;
    },
  });
  const payload = {
    action: "closed",
    repository: { full_name: "other/repo" },
    pull_request: {
      number: 77,
      merged: true,
      merged_at: "2026-02-13T17:00:00Z",
      title: "Ship it",
      html_url: "https://github.com/other/repo/pull/77",
      base: { ref: "main" },
    },
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(upsertCalled, false);
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

test("github webhook returns 500 if upsert fails", async () => {
  const secret = "secret";
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    upsertPullRequestAsUntestedFn: async () => {
      throw new Error("db failed");
    },
  });
  const payload = {
    action: "closed",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 88,
      merged: true,
      merged_at: "2026-02-13T17:00:00Z",
      title: "Ship it",
      html_url: "https://github.com/croft-eng/croft/pull/88",
      base: { ref: "main" },
    },
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "internal error");
});
