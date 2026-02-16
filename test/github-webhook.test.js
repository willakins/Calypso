const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createGithubWebhookHandler,
  registerGithubWebhook,
} = require("../src/platform/code_host/providers/github/webhook");
const { verifyGithubSignature } = require("../src/platform/code_host/providers/github/verify_signature");

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

function buildPullRequestPayload(overrides = {}) {
  return {
    action: "opened",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 77,
      merged: false,
      merged_at: null,
      created_at: "2026-02-13T17:00:00Z",
      updated_at: "2026-02-13T17:00:00Z",
      closed_at: null,
      draft: false,
      title: "Ship it",
      html_url: "https://github.com/croft-eng/croft/pull/77",
      base: { ref: "main" },
      user: { login: "octocat" },
    },
    ...overrides,
  };
}

function buildPullRequestReviewPayload(overrides = {}) {
  return {
    action: "submitted",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 77,
      base: { ref: "main" },
    },
    review: {
      state: "approved",
      submitted_at: "2026-02-13T18:00:00Z",
    },
    ...overrides,
  };
}

test("verifyGithubSignature validates a correct sha256 signature", () => {
  const secret = "test-secret";
  const payloadBuffer = Buffer.from('{"ok":true}', "utf8");
  const signatureHeader = signPayload(secret, payloadBuffer);

  const valid = verifyGithubSignature({ payloadBuffer, signatureHeader, secret });
  assert.equal(valid, true);
});

test("registerGithubWebhook registers both configured webhook paths", () => {
  const registeredPaths = [];
  const app = {
    post(path, _rawMiddleware, _handler) {
      registeredPaths.push(path);
    },
  };

  registerGithubWebhook(app, {
    pool: {},
    github: {
      mainBranch: "main",
      repositoryFullName: "croft-eng/croft",
      webhookSecret: "secret",
    },
    paths: ["/github/webhook", "/codehost/webhook"],
  });

  assert.deepEqual(registeredPaths, ["/github/webhook", "/codehost/webhook"]);
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

test("github webhook ignores unsupported event types", async () => {
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

test("github webhook ignores pull request events outside tracked branch/repo", async () => {
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
  const payload = buildPullRequestPayload({
    repository: { full_name: "other/repo" },
  });
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

test("github webhook tracks opened pull request review lifecycle", async () => {
  let savedReviewState;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
  });
  const payload = buildPullRequestPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedReviewState.repo, "croft-eng/croft");
  assert.equal(savedReviewState.prNumber, 77);
  assert.equal(savedReviewState.reviewState, "waiting");
  assert.equal(savedReviewState.lifecycleState, "open");
  assert.equal(savedReviewState.openedForReviewAt, "2026-02-13T17:00:00Z");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook tracks ready_for_review transitions", async () => {
  let savedReviewState;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
  });
  const payload = buildPullRequestPayload({
    action: "ready_for_review",
    pull_request: {
      ...buildPullRequestPayload().pull_request,
      draft: false,
      updated_at: "2026-02-14T11:00:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({ payload, signature: signPayload("secret", body) });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedReviewState.isDraft, false);
  assert.equal(savedReviewState.reviewState, "waiting");
  assert.equal(savedReviewState.openedForReviewAt, "2026-02-14T11:00:00Z");
});

test("github webhook upserts merged main PR as untested while updating review state", async () => {
  let savedPullRequest;
  let savedReviewState;
  const handler = createGithubWebhookHandler({
    pool: { marker: "pool" },
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
    upsertPullRequestAsUntestedFn: async (_pool, pr) => {
      savedPullRequest = pr;
      return { pr_number: pr.prNumber, status: "untested" };
    },
  });
  const payload = buildPullRequestPayload({
    action: "closed",
    pull_request: {
      ...buildPullRequestPayload().pull_request,
      merged: true,
      merged_at: "2026-02-13T17:00:00Z",
      closed_at: "2026-02-13T17:10:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(savedPullRequest.repo, "croft-eng/croft");
  assert.equal(savedPullRequest.prNumber, 77);
  assert.equal(savedPullRequest.mergedAt, "2026-02-13T17:00:00Z");
  assert.equal(savedReviewState.lifecycleState, "merged");
});

test("github webhook updates review state on submitted approval", async () => {
  let updatedReview;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      updatedReview = reviewUpdate;
      return { pr_number: reviewUpdate.prNumber, review_state: reviewUpdate.reviewState };
    },
  });
  const payload = buildPullRequestReviewPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedReview.repo, "croft-eng/croft");
  assert.equal(updatedReview.prNumber, 77);
  assert.equal(updatedReview.reviewState, "approved");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook tracks commented review submission without forcing approval", async () => {
  let updatedReview;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      updatedReview = reviewUpdate;
      return { pr_number: reviewUpdate.prNumber, review_state: "waiting" };
    },
  });
  const payload = buildPullRequestReviewPayload({
    review: {
      state: "commented",
      submitted_at: "2026-02-13T18:30:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedReview.reviewState, null);
  assert.equal(updatedReview.lastReviewedAt, "2026-02-13T18:30:00Z");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook ignores review events outside tracked branch/repo", async () => {
  const secret = "secret";
  let updateCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    updatePullRequestReviewSubmissionFn: async () => {
      updateCalled = true;
    },
  });
  const payload = buildPullRequestReviewPayload({
    repository: { full_name: "other/repo" },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(updateCalled, false);
});

test("github webhook returns 500 if persistence fails", async () => {
  const secret = "secret";
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    upsertOpenPullRequestReviewStateFn: async () => {
      throw new Error("db failed");
    },
  });
  const payload = buildPullRequestPayload();
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
