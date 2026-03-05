const DEPLOY_PROD_TIP_TEXT =
  "Pro tip: you can use /calypso deploy prod instead. Or /calypso deploy prod force if needed.";

function shouldSendDeployProdTip(rawText) {
  return normalizeMessageText(rawText) === "deploying prod";
}

function normalizeMessageText(rawText) {
  return String(rawText || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}

module.exports = {
  DEPLOY_PROD_TIP_TEXT,
  shouldSendDeployProdTip,
};
