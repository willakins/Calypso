const express = require("express");

function registerRawJsonWebhookRoutes(httpApp, { paths, defaultPath, handler }) {
  const webhookPaths = Array.isArray(paths) && paths.length > 0 ? paths : [defaultPath];

  for (const webhookPath of webhookPaths) {
    httpApp.post(webhookPath, express.raw({ type: "application/json" }), handler);
  }
}

function createCodeHostWebhookHandler({
  providerLabel,
  webhookSecret,
  isRequestSignatureValid,
  readDeliveryId = () => null,
  readEventName,
  describePayload = () => ({}),
  isSupportedEvent,
  isPullRequestForTrackedMain,
  processEvent,
  logger = console,
}) {
  return async (request, response) => {
    const eventName = readEventName(request);
    const deliveryId = readDeliveryId(request);

    if (!isRequestSignatureValid(request, webhookSecret)) {
      logWebhookDiagnostic(logger, providerLabel, "rejected_invalid_signature", {
        delivery_id: deliveryId,
        event: eventName,
        body_bytes: readRequestBodyByteLength(request.body),
      });
      return response.status(401).json({ ok: false, error: "invalid signature" });
    }

    const payload = tryParseJsonPayload(request.body);
    if (!payload) {
      logWebhookDiagnostic(logger, providerLabel, "rejected_invalid_json", {
        delivery_id: deliveryId,
        event: eventName,
        body_bytes: readRequestBodyByteLength(request.body),
      });
      return response.status(400).json({ ok: false, error: "invalid json payload" });
    }

    const payloadDescription = describePayload(payload, eventName) || {};
    if (!isSupportedEvent(eventName)) {
      logWebhookDiagnostic(logger, providerLabel, "ignored_unsupported_event", {
        delivery_id: deliveryId,
        event: eventName,
        ...payloadDescription,
      });
      return response.status(200).json({ ok: true, ignored: true });
    }

    if (!isPullRequestForTrackedMain(payload, eventName)) {
      logWebhookDiagnostic(logger, providerLabel, "ignored_untracked_repo_or_branch", {
        delivery_id: deliveryId,
        event: eventName,
        ...payloadDescription,
      });
      return response.status(200).json({ ok: true, ignored: true });
    }

    try {
      const result = await processEvent({ eventName, payload });
      logWebhookDiagnostic(logger, providerLabel, result?.ignored ? "ignored_by_processor" : "processed", {
        delivery_id: deliveryId,
        event: eventName,
        ...payloadDescription,
        ...summarizeWebhookResult(result),
      });
      return response.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      logWebhookDiagnostic(logger, providerLabel, "failed_processing", {
        delivery_id: deliveryId,
        event: eventName,
        ...payloadDescription,
        error: error.message,
      }, "error");
      return response.status(500).json({ ok: false, error: "internal error" });
    }
  };
}

function tryParseJsonPayload(rawBodyBuffer) {
  try {
    return JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function readRequestBodyByteLength(body) {
  if (Buffer.isBuffer(body) || typeof body === "string") {
    return body.length;
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }

  return null;
}

function summarizeWebhookResult(result) {
  if (!result || typeof result !== "object") {
    return {};
  }

  return {
    ignored: result.ignored,
    pr_number: result.pr_number,
    status: result.status,
    review_tracking_updated: result.review_tracking_updated,
    review_state: result.review_state,
    codex_approved: result.codex_approved,
  };
}

function logWebhookDiagnostic(logger, providerLabel, outcome, fields, level = "info") {
  const logFn = readLogFunction(logger, level);
  if (!logFn) {
    return;
  }

  logFn(`[code-host-webhook] ${JSON.stringify(compactDiagnosticFields({
    provider: providerLabel,
    outcome,
    ...fields,
  }))}`);
}

function readLogFunction(logger, level) {
  if (!logger) {
    return null;
  }

  if (typeof logger[level] === "function") {
    return logger[level].bind(logger);
  }

  if (level !== "info" && typeof logger.info === "function") {
    return logger.info.bind(logger);
  }

  if (typeof logger.log === "function") {
    return logger.log.bind(logger);
  }

  return null;
}

function compactDiagnosticFields(fields) {
  const compactedFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    compactedFields[key] = value;
  }

  return compactedFields;
}

module.exports = {
  createCodeHostWebhookHandler,
  registerRawJsonWebhookRoutes,
};
