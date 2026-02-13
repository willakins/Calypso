const express = require("express");

const { upsertPullRequestAsUntested } = require("../../db");
const { verifyGithubSignature } = require("./verify_signature");

function isMergedPullRequestToMain(payload, config) {
  return (
    payload.action === "closed" &&
    payload.pull_request &&
    payload.pull_request.merged === true &&
    payload.pull_request.base &&
    payload.pull_request.base.ref === config.githubMainBranch &&
    payload.repository &&
    payload.repository.full_name === config.githubRepo
  );
}

function registerGithubWebhook(app, options) {
  app.post(
    "/github/webhook",
    express.raw({ type: "application/json" }),
    createGithubWebhookHandler(options),
  );
}

function createGithubWebhookHandler(options) {
  const { pool, config } = options;
  const upsertPullRequestAsUntestedFn =
    options.upsertPullRequestAsUntestedFn || upsertPullRequestAsUntested;

  return async (req, res) => {
    const signatureHeader = req.get("x-hub-signature-256");
    const signatureValid = verifyGithubSignature({
      payloadBuffer: req.body,
      signatureHeader,
      secret: config.githubWebhookSecret,
    });

    if (!signatureValid) {
      res.status(401).json({ ok: false, error: "invalid signature" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (_error) {
      res.status(400).json({ ok: false, error: "invalid json payload" });
      return;
    }

    if (req.get("x-github-event") !== "pull_request") {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    if (!isMergedPullRequestToMain(payload, config)) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      const pr = payload.pull_request;
      const repo = payload.repository.full_name;

      const saved = await upsertPullRequestAsUntestedFn(pool, {
        repo,
        prNumber: pr.number,
        title: pr.title || null,
        url: pr.html_url || null,
        mergedAt: pr.merged_at,
      });

      res.status(200).json({ ok: true, pr_number: saved.pr_number, status: saved.status });
    } catch (error) {
      console.error("Failed to process GitHub webhook.");
      console.error(error.message);
      res.status(500).json({ ok: false, error: "internal error" });
    }
  };
}

module.exports = {
  createGithubWebhookHandler,
  registerGithubWebhook,
};
