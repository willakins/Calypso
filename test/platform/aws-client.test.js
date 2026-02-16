const assert = require("node:assert/strict");
const test = require("node:test");

const { createAwsCodePipelineClient } = require("../../src/platform/deploy/providers/aws/client");

test("createAwsCodePipelineClient requires credentials and region", () => {
  assert.throws(
    () =>
      createAwsCodePipelineClient({
        accessKeyId: "",
        secretAccessKey: "secret",
        region: "us-east-1",
      }),
    /DEPLOY_ACCESS_KEY_ID is required/,
  );
  assert.throws(
    () =>
      createAwsCodePipelineClient({
        accessKeyId: "key",
        secretAccessKey: "",
        region: "us-east-1",
      }),
    /DEPLOY_SECRET_ACCESS_KEY is required/,
  );
  assert.throws(
    () =>
      createAwsCodePipelineClient({
        accessKeyId: "key",
        secretAccessKey: "secret",
        region: "",
      }),
    /DEPLOY_REGION is required/,
  );
});

test("triggerPipelineDeployment sends signed CodePipeline request", async () => {
  await withMockedFetch(
    async (url, requestInit) => {
      assert.equal(url, "https://codepipeline.us-east-1.amazonaws.com/");
      assert.equal(requestInit.method, "POST");
      assert.equal(
        requestInit.headers["x-amz-target"],
        "CodePipeline_20150709.StartPipelineExecution",
      );
      assert.match(requestInit.headers.authorization, /^AWS4-HMAC-SHA256 /);
      assert.match(requestInit.headers.authorization, /Credential=AKIA123/);
      assert.deepEqual(JSON.parse(requestInit.body), { name: "prod-pipeline" });

      return {
        ok: true,
        async text() {
          return JSON.stringify({ pipelineExecutionId: "exec-123" });
        },
      };
    },
    async () => {
      const client = createAwsCodePipelineClient({
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
        region: "us-east-1",
        nowFn: () => Date.parse("2026-02-16T22:00:00.000Z"),
      });

      const result = await client.triggerPipelineDeployment("prod-pipeline");
      assert.deepEqual(result, { externalDeployId: "exec-123" });
    },
  );
});

test("waitForPipelineDeploymentCompletion returns on succeeded status", async () => {
  let now = Date.parse("2026-02-16T22:00:00.000Z");
  let requestCount = 0;

  await withMockedFetch(
    async (_url, requestInit) => {
      requestCount += 1;
      assert.equal(requestInit.headers["x-amz-target"], "CodePipeline_20150709.GetPipelineExecution");
      assert.deepEqual(JSON.parse(requestInit.body), {
        name: "prod-pipeline",
        pipelineExecutionId: "exec-123",
      });

      return {
        ok: true,
        async text() {
          if (requestCount === 1) {
            return JSON.stringify({ pipelineExecution: { status: "InProgress" } });
          }

          return JSON.stringify({ pipelineExecution: { status: "Succeeded" } });
        },
      };
    },
    async () => {
      const client = createAwsCodePipelineClient({
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
        region: "us-east-1",
        nowFn: () => now,
        sleepFn: async (milliseconds) => {
          now += milliseconds;
        },
      });

      const result = await client.waitForPipelineDeploymentCompletion(
        "prod-pipeline",
        "exec-123",
        {
          pollIntervalMs: 5,
          timeoutMs: 100,
        },
      );
      assert.deepEqual(result, { id: "exec-123", status: "Succeeded" });
      assert.equal(requestCount, 2);
    },
  );
});

test("waitForPipelineDeploymentCompletion throws on failed status", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      async text() {
        return JSON.stringify({ pipelineExecution: { status: "Failed" } });
      },
    }),
    async () => {
      const client = createAwsCodePipelineClient({
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
        region: "us-east-1",
        nowFn: () => Date.parse("2026-02-16T22:00:00.000Z"),
      });

      await assert.rejects(
        () =>
          client.waitForPipelineDeploymentCompletion("prod-pipeline", "exec-123", {
            pollIntervalMs: 1,
            timeoutMs: 50,
          }),
        /finished with status Failed/,
      );
    },
  );
});

test("aws client surfaces response details on request failure", async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "forbidden";
      },
    }),
    async () => {
      const client = createAwsCodePipelineClient({
        accessKeyId: "AKIA123",
        secretAccessKey: "secret",
        region: "us-east-1",
        nowFn: () => Date.parse("2026-02-16T22:00:00.000Z"),
      });

      await assert.rejects(
        () => client.triggerPipelineDeployment("prod-pipeline"),
        /AWS deploy failed \(403\).*StartPipelineExecution: forbidden/,
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
