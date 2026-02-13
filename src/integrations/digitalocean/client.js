function createDigitalOceanClient({ token }) {
  ensureRequiredValueExists(token, "DIGITALOCEAN_TOKEN");

  return {
    async triggerAppDeployment(appId) {
      ensureRequiredValueExists(appId, "DO_APP_ID_PROD");

      const deploymentRequest = buildDeploymentRequest({ token, appId });
      const deploymentResponse = await fetch(
        deploymentRequest.url,
        deploymentRequest.requestInit,
      );

      await throwIfDeploymentRequestFailed(deploymentResponse);

      const payload = await deploymentResponse.json();
      return {
        externalDeployId: readExternalDeploymentId(payload),
      };
    },
  };
}

function ensureRequiredValueExists(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

function buildDeploymentRequest({ token, appId }) {
  // DigitalOcean's app deployment API uses force_build for "Force Rebuild and Deploy".
  // There is no documented API field for "clear build cache", so we intentionally
  // rely on the platform default cache behavior.
  const deploymentBody = {
    force_build: true,
  };

  return {
    url: buildDeploymentEndpointUrl(appId),
    requestInit: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deploymentBody),
    },
  };
}

function buildDeploymentEndpointUrl(appId) {
  return `https://api.digitalocean.com/v2/apps/${appId}/deployments`;
}

async function throwIfDeploymentRequestFailed(response) {
  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(`DigitalOcean deploy failed (${response.status}): ${responseBody}`);
}

function readExternalDeploymentId(payload) {
  const deployment = payload.deployment || {};
  return deployment.id ? String(deployment.id) : null;
}

module.exports = {
  createDigitalOceanClient,
};
