const express = require("express");

const {
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntested,
} = require("../../../../db");
const { verifyGithubSignature } = require("./verify_signature");

function registerGithubWebhook(httpApp, options) {
  const webhookPaths = Array.isArray(options.paths) && options.paths.length > 0
    ? options.paths
    : ["/github/webhook"];
  const webhookHandler = createGithubWebhookHandler(options);

  for (const webhookPath of webhookPaths) {
    httpApp.post(
      webhookPath,
      express.raw({ type: "application/json" }),
      webhookHandler,
    );
  }
}

function createGithubWebhookHandler(options) {
  const {
    pool,
    upsertPullRequestAsUntestedFn = upsertPullRequestAsUntested,
    upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
    updatePullRequestReviewSubmissionFn = updatePullRequestReviewSubmission,
  } = options;
  const githubSettings = readGithubSettings(options);

  return async (request, response) => {
    if (!isRequestSignatureValid(request, githubSettings.webhookSecret)) {
      return response.status(401).json({ ok: false, error: "invalid signature" });
    }

    const payload = tryParseJsonPayload(request.body);
    if (!payload) {
      return response.status(400).json({ ok: false, error: "invalid json payload" });
    }

    const eventName = readGithubEventName(request);
    if (!isSupportedGithubWebhookEvent(eventName)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    if (!isPullRequestForTrackedMain(payload, githubSettings)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    try {
      const result = await processWebhookEvent({
        eventName,
        payload,
        pool,
        upsertPullRequestAsUntestedFn,
        upsertOpenPullRequestReviewStateFn,
        updatePullRequestReviewSubmissionFn,
      });

      return response.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error("Failed to process GitHub webhook.");
      console.error(error.message);
      return response.status(500).json({ ok: false, error: "internal error" });
    }
  };
}

async function processWebhookEvent({
  eventName,
  payload,
  pool,
  upsertPullRequestAsUntestedFn,
  upsertOpenPullRequestReviewStateFn,
  updatePullRequestReviewSubmissionFn,
}) {
  if (eventName === "pull_request") {
    return processPullRequestWebhookEvent({
      payload,
      pool,
      upsertPullRequestAsUntestedFn,
      upsertOpenPullRequestReviewStateFn,
    });
  }

  if (eventName === "pull_request_review") {
    return processPullRequestReviewWebhookEvent({
      payload,
      pool,
      updatePullRequestReviewSubmissionFn,
    });
  }

  return { ignored: true };
}

async function processPullRequestWebhookEvent({
  payload,
  pool,
  upsertPullRequestAsUntestedFn,
  upsertOpenPullRequestReviewStateFn,
}) {
  let savedReviewState = null;
  const mappedReviewState = mapPullRequestLifecyclePayload(payload);
  if (mappedReviewState) {
    savedReviewState = await upsertOpenPullRequestReviewStateFn(pool, mappedReviewState);
  }

  let savedPullRequest = null;
  if (isMergedPullRequestPayload(payload)) {
    const pullRequestRecord = mapPayloadToPullRequestRecord(payload);
    savedPullRequest = await upsertPullRequestAsUntestedFn(pool, pullRequestRecord);
  }

  if (savedPullRequest) {
    return {
      pr_number: savedPullRequest.pr_number,
      status: savedPullRequest.status,
    };
  }

  if (savedReviewState) {
    return {
      review_tracking_updated: true,
      pr_number: savedReviewState.pr_number,
      review_state: savedReviewState.review_state,
    };
  }

  return { ignored: true };
}

async function processPullRequestReviewWebhookEvent({
  payload,
  pool,
  updatePullRequestReviewSubmissionFn,
}) {
  if (String(payload.action || "").toLowerCase() !== "submitted") {
    return { ignored: true };
  }

  const mappedReviewSubmission = mapPullRequestReviewSubmission(payload);
  if (!mappedReviewSubmission) {
    return { ignored: true };
  }

  const updatedReviewRecord = await updatePullRequestReviewSubmissionFn(pool, mappedReviewSubmission);
  return {
    review_tracking_updated: Boolean(updatedReviewRecord),
    pr_number: mappedReviewSubmission.prNumber,
    review_state: updatedReviewRecord?.review_state || null,
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
    mainBranch: legacyConfig.codeHostMainBranch || legacyConfig.githubMainBranch,
    repositoryFullName: legacyConfig.codeHostRepository || legacyConfig.githubRepo,
    webhookSecret: legacyConfig.codeHostWebhookSecret || legacyConfig.githubWebhookSecret,
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

function readGithubEventName(request) {
  return String(request.get("x-github-event") || "").toLowerCase();
}

function isSupportedGithubWebhookEvent(eventName) {
  return eventName === "pull_request" || eventName === "pull_request_review";
}

function isPullRequestForTrackedMain(payload, githubSettings) {
  return (
    payload.pull_request &&
    payload.pull_request.base &&
    payload.pull_request.base.ref === githubSettings.mainBranch &&
    payload.repository &&
    payload.repository.full_name === githubSettings.repositoryFullName
  );
}

function isMergedPullRequestPayload(payload) {
  return String(payload.action || "").toLowerCase() === "closed" && payload.pull_request?.merged === true;
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

function mapPullRequestLifecyclePayload(payload) {
  const action = String(payload.action || "").toLowerCase();
  const pullRequest = payload.pull_request;
  if (!pullRequest || !payload.repository) {
    return null;
  }

  const baseState = {
    repo: payload.repository.full_name,
    prNumber: pullRequest.number,
    title: pullRequest.title || null,
    url: pullRequest.html_url || null,
    authorLogin: pullRequest.user?.login || "unknown",
    baseBranch: pullRequest.base?.ref || "",
    openedAt: pullRequest.created_at,
    lastReviewedAt: null,
  };

  if (action === "opened") {
    const isDraft = Boolean(pullRequest.draft);
    return {
      ...baseState,
      isDraft,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : pullRequest.created_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "ready_for_review") {
    return {
      ...baseState,
      isDraft: false,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: pullRequest.updated_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "converted_to_draft") {
    return {
      ...baseState,
      isDraft: true,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: null,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "synchronize" || action === "review_requested" || action === "reopened") {
    const isDraft = Boolean(pullRequest.draft);
    return {
      ...baseState,
      isDraft,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : pullRequest.updated_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "closed") {
    const isMerged = Boolean(pullRequest.merged);
    return {
      ...baseState,
      isDraft: Boolean(pullRequest.draft),
      lifecycleState: isMerged ? "merged" : "closed",
      reviewState: "waiting",
      openedForReviewAt: Boolean(pullRequest.draft) ? null : pullRequest.updated_at,
      closedAt: isMerged ? null : pullRequest.closed_at || pullRequest.updated_at,
      mergedAt: isMerged ? pullRequest.merged_at : null,
    };
  }

  return null;
}

function mapPullRequestReviewSubmission(payload) {
  const reviewState = mapPullRequestReviewState(payload.review?.state);
  if (reviewState === undefined) {
    return null;
  }

  return {
    repo: payload.repository.full_name,
    prNumber: payload.pull_request.number,
    reviewState,
    lastReviewedAt: payload.review?.submitted_at || payload.review?.updated_at || null,
  };
}

function mapPullRequestReviewState(rawReviewState) {
  const normalizedReviewState = String(rawReviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedReviewState === "commented") {
    return null;
  }

  return undefined;
}

module.exports = {
  createGithubWebhookHandler,
  registerGithubWebhook,
};
