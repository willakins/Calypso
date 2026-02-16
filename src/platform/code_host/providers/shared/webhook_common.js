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
  readEventName,
  isSupportedEvent,
  isPullRequestForTrackedMain,
  processEvent,
}) {
  return async (request, response) => {
    if (!isRequestSignatureValid(request, webhookSecret)) {
      return response.status(401).json({ ok: false, error: "invalid signature" });
    }

    const payload = tryParseJsonPayload(request.body);
    if (!payload) {
      return response.status(400).json({ ok: false, error: "invalid json payload" });
    }

    const eventName = readEventName(request);
    if (!isSupportedEvent(eventName)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    if (!isPullRequestForTrackedMain(payload)) {
      return response.status(200).json({ ok: true, ignored: true });
    }

    try {
      const result = await processEvent({ eventName, payload });
      return response.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(`Failed to process ${providerLabel} webhook.`);
      console.error(error.message);
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

module.exports = {
  createCodeHostWebhookHandler,
  registerRawJsonWebhookRoutes,
};
