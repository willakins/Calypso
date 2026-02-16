const crypto = require("node:crypto");

const AWS_CODEPIPELINE_SERVICE = "codepipeline";
const AWS_CODEPIPELINE_TARGET_PREFIX = "CodePipeline_20150709";
const AWS_DEPLOY_SUCCESS_STATUSES = new Set(["Succeeded"]);
const AWS_DEPLOY_FAILURE_STATUSES = new Set(["Cancelled", "Failed", "Stopped", "Superseded"]);

function createAwsCodePipelineClient(options) {
  const clientSettings = normalizeAwsClientSettings(options);

  return {
    async triggerPipelineDeployment(pipelineName) {
      assertNonEmptyString(pipelineName, "DEPLOY_PROD_APP_ID");

      const responsePayload = await sendAwsCodePipelineRequest({
        clientSettings,
        target: `${AWS_CODEPIPELINE_TARGET_PREFIX}.StartPipelineExecution`,
        payload: { name: pipelineName },
      });

      return {
        externalDeployId: responsePayload?.pipelineExecutionId || null,
      };
    },

    async waitForPipelineDeploymentCompletion(pipelineName, pipelineExecutionId, waitOptions = {}) {
      assertNonEmptyString(pipelineName, "DEPLOY_PROD_APP_ID");
      assertNonEmptyString(pipelineExecutionId, "pipeline execution id");

      const pollIntervalMs = readPositiveInteger(
        waitOptions.pollIntervalMs,
        "poll interval",
        10_000,
      );
      const timeoutMs = readPositiveInteger(
        waitOptions.timeoutMs,
        "timeout",
        20 * 60 * 1000,
      );
      const startTimeMs = clientSettings.nowFn();

      while (clientSettings.nowFn() - startTimeMs <= timeoutMs) {
        const responsePayload = await sendAwsCodePipelineRequest({
          clientSettings,
          target: `${AWS_CODEPIPELINE_TARGET_PREFIX}.GetPipelineExecution`,
          payload: {
            name: pipelineName,
            pipelineExecutionId,
          },
        });
        const deploymentStatus = String(
          responsePayload?.pipelineExecution?.status || "UNKNOWN",
        );
        if (AWS_DEPLOY_SUCCESS_STATUSES.has(deploymentStatus)) {
          return {
            id: pipelineExecutionId,
            status: deploymentStatus,
          };
        }
        if (AWS_DEPLOY_FAILURE_STATUSES.has(deploymentStatus)) {
          throw new Error(
            `AWS deployment ${pipelineExecutionId} finished with status ${deploymentStatus}.`,
          );
        }

        await clientSettings.sleepFn(pollIntervalMs);
      }

      throw new Error(
        `Timed out waiting for AWS deployment ${pipelineExecutionId} to complete.`,
      );
    },
  };
}

function normalizeAwsClientSettings(options) {
  const settings = options || {};

  assertNonEmptyString(settings.accessKeyId, "DEPLOY_ACCESS_KEY_ID");
  assertNonEmptyString(settings.secretAccessKey, "DEPLOY_SECRET_ACCESS_KEY");
  assertNonEmptyString(settings.region, "DEPLOY_REGION");

  return {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    sessionToken: String(settings.sessionToken || "").trim() || null,
    region: settings.region,
    nowFn: typeof settings.nowFn === "function" ? settings.nowFn : () => Date.now(),
    sleepFn:
      typeof settings.sleepFn === "function"
        ? settings.sleepFn
        : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}

async function sendAwsCodePipelineRequest({ clientSettings, target, payload }) {
  const requestBody = JSON.stringify(payload || {});
  const requestUrl = new URL(`https://${AWS_CODEPIPELINE_SERVICE}.${clientSettings.region}.amazonaws.com/`);
  const { amzDate, dateStamp } = buildAwsTimestamp(new Date(clientSettings.nowFn()));

  const baseHeaders = {
    "content-type": "application/x-amz-json-1.1",
    host: requestUrl.host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };
  if (clientSettings.sessionToken) {
    baseHeaders["x-amz-security-token"] = clientSettings.sessionToken;
  }

  const authorizationHeader = buildAwsAuthorizationHeader({
    accessKeyId: clientSettings.accessKeyId,
    dateStamp,
    headers: baseHeaders,
    method: "POST",
    region: clientSettings.region,
    requestBody,
    requestUrl,
    secretAccessKey: clientSettings.secretAccessKey,
    service: AWS_CODEPIPELINE_SERVICE,
    amzDate,
  });

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
    headers: {
      ...baseHeaders,
      authorization: authorizationHeader,
    },
    body: requestBody,
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`AWS deploy failed (${response.status}) for ${target}: ${responseBody}`);
  }

  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch (_error) {
    throw new Error(`AWS deploy returned invalid JSON for ${target}.`);
  }
}

function buildAwsAuthorizationHeader({
  accessKeyId,
  amzDate,
  dateStamp,
  headers,
  method,
  region,
  requestBody,
  requestUrl,
  secretAccessKey,
  service,
}) {
  const normalizedHeaders = normalizeHeadersForSigning(headers);
  const signedHeaderNames = Object.keys(normalizedHeaders).sort();
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${normalizedHeaders[name]}\n`)
    .join("");
  const canonicalQueryString = buildCanonicalQueryString(requestUrl);
  const canonicalRequest = [
    method,
    requestUrl.pathname || "/",
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(requestBody),
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createAwsSignature({
    dateStamp,
    region,
    secretAccessKey,
    service,
    stringToSign,
  });

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function buildCanonicalQueryString(requestUrl) {
  const queryEntries = [...requestUrl.searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    });

  return queryEntries.map(([key, value]) => `${key}=${value}`).join("&");
}

function normalizeHeadersForSigning(headers) {
  const normalized = {};

  for (const [name, value] of Object.entries(headers || {})) {
    const normalizedName = String(name || "").trim().toLowerCase();
    if (!normalizedName) {
      continue;
    }
    normalized[normalizedName] = String(value || "").trim().replace(/\s+/g, " ");
  }

  return normalized;
}

function buildAwsTimestamp(now) {
  const iso = now.toISOString();
  const amzDate = iso.replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  return {
    amzDate,
    dateStamp,
  };
}

function createAwsSignature({ dateStamp, region, secretAccessKey, service, stringToSign }) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  return hmac(signingKey, stringToSign, "hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value || "")).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function assertNonEmptyString(value, name) {
  if (!String(value || "").trim()) {
    throw new Error(`${name} is required`);
  }
}

function readPositiveInteger(value, name, fallbackValue) {
  if (value === undefined || value === null || value === "") {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

module.exports = {
  createAwsCodePipelineClient,
};
