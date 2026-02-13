function createDigitalOceanClient({ token }) {
  if (!token) {
    throw new Error("DIGITALOCEAN_TOKEN is required");
  }

  return {
    async triggerAppDeployment(appId) {
      if (!appId) {
        throw new Error("DO_APP_ID_PROD is required");
      }

      const response = await fetch(`https://api.digitalocean.com/v2/apps/${appId}/deployments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force_build: true }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`DigitalOcean deploy failed (${response.status}): ${bodyText}`);
      }

      const payload = await response.json();
      return {
        externalDeployId: payload.deployment && payload.deployment.id ? String(payload.deployment.id) : null,
      };
    },
  };
}

module.exports = {
  createDigitalOceanClient,
};
