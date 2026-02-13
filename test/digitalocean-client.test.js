const assert = require("node:assert/strict");
const test = require("node:test");

const { createDigitalOceanClient } = require("../src/integrations/digitalocean/client");

test("createDigitalOceanClient requires token", () => {
  assert.throws(() => createDigitalOceanClient({ token: "" }), /DIGITALOCEAN_TOKEN is required/);
});

test("triggerAppDeployment requires app id", async () => {
  const client = createDigitalOceanClient({ token: "token" });
  await assert.rejects(
    () => client.triggerAppDeployment(""),
    /DO_APP_ID_PROD is required/,
  );
});

test("triggerAppDeployment sends expected request and maps deployment id", async () => {
  await withMockedFetch(
    async (url, requestInit) => {
      assert.equal(url, "https://api.digitalocean.com/v2/apps/app-123/deployments");
      assert.equal(requestInit.method, "POST");
      assert.equal(requestInit.headers.Authorization, "Bearer token-123");
      assert.equal(requestInit.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(requestInit.body), { force_build: true });

      return {
        ok: true,
        async json() {
          return { deployment: { id: "dep-123" } };
        },
      };
    },
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      const result = await client.triggerAppDeployment("app-123");
      assert.deepEqual(result, { externalDeployId: "dep-123" });
    },
  );
});

test("triggerAppDeployment returns null id when deployment id is missing", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      async json() {
        return { deployment: {} };
      },
    }),
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      const result = await client.triggerAppDeployment("app-123");
      assert.deepEqual(result, { externalDeployId: null });
    },
  );
});

test("triggerAppDeployment throws with status and response body when request fails", async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "forbidden";
      },
    }),
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      await assert.rejects(
        () => client.triggerAppDeployment("app-123"),
        /DigitalOcean deploy failed \(403\): forbidden/,
      );
    },
  );
});

async function withMockedFetch(mockImplementation, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockImplementation;

  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}
