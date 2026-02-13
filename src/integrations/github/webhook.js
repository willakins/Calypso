const express = require("express");

const { upsertPullRequestAsUntested } = require("../../db");
const { verifyGithubSignature } = require("./verify_signature");

function registerGithubWebhook(httpApp, options) {
  httpApp.post(
    "/github/webhook",
    express.raw({ type: "application/json" }),
    createGithubWebhookHandler(options),
  );
}

function createGithubWebhookHandler(options) {
  const { pool, upsertPullRequestAsUntestedFn = upsertPullRequestAsUntested } = options;
  const githubSettings = readGithubSettings(options);

  return async (request, response) => {
    if (!isRequestSignatureValid(request, githubSettings.webhookSecret)) {
      return response.status(401).json({ ok: false, error: "invalid signature" });
    }

    const payload = tryParseJsonPayload(request.body);
    if (!payload) {
      return response.status(400).json({ ok: false, error: "invalid json payload" });
    }

    if (!isPullRequestWebhookEvent(request)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    if (!isMergedPullRequestForTrackedMain(payload, githubSettings)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    try {
      const pullRequestRecord = mapPayloadToPullRequestRecord(payload);
      const savedPullRequest = await upsertPullRequestAsUntestedFn(pool, pullRequestRecord);

      return response.status(200).json({
        ok: true,
        pr_number: savedPullRequest.pr_number,
        status: savedPullRequest.status,
      });
    } catch (error) {
      console.error("Failed to process GitHub webhook.");
      console.error(error.message);
      return response.status(500).json({ ok: false, error: "internal error" });
    }
  };
}

function readGithubSettings(options) {
  if (options.github) {
    return {
      mainBranch: options.github.mainBranch,
      repositoryFullName: options.github.repositoryFullName,
      webhookSecret: options.github.webhookSecret,
    };
  }

  const legacyConfig = options.config || {};
  return {
    mainBranch: legacyConfig.githubMainBranch,
    repositoryFullName: legacyConfig.githubRepo,
    webhookSecret: legacyConfig.githubWebhookSecret,
  };
}

function isRequestSignatureValid(request, webhookSecret) {
  return verifyGithubSignature({
    payloadBuffer: request.body,
    signatureHeader: request.get("x-hub-signature-256"),
    secret: webhookSecret,
  });
}

function tryParseJsonPayload(rawBodyBuffer) {
  try {
    return JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function isPullRequestWebhookEvent(request) {
  return request.get("x-github-event") === "pull_request";
}

function isMergedPullRequestForTrackedMain(payload, githubSettings) {
  return (
    payload.action === "closed" &&
    payload.pull_request &&
    payload.pull_request.merged === true &&
    payload.pull_request.base &&
    payload.pull_request.base.ref === githubSettings.mainBranch &&
    payload.repository &&
    payload.repository.full_name === githubSettings.repositoryFullName
  );
}

function mapPayloadToPullRequestRecord(payload) {
  return {
    repo: payload.repository.full_name,
    prNumber: payload.pull_request.number,
    title: payload.pull_request.title || null,
    url: payload.pull_request.html_url || null,
    mergedAt: payload.pull_request.merged_at,
  };
}

module.exports = {
  createGithubWebhookHandler,
  registerGithubWebhook,
};
