const assert = require("node:assert/strict");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");

test("high-level command lifecycle: status -> tested -> deploy -> status", async () => {
  const state = createInMemoryState();
  const { app, commandHandler } = createCommandHandler({
    pool: createPoolTransactionRecorder(state),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app",
    },
    getLastProdDeployAtFn: async () => state.lastProductionDeploymentAt,
    listBlockingPullRequestsFn: async (_pool, lastDeployAt) =>
      state.pullRequests.filter(
        (pr) =>
          pr.merged_at > lastDeployAt && pr.status !== "tested" && pr.status !== "deployed",
      ),
    markPullRequestTestedFn: async (_pool, prNumber, testedBy) => {
      const pullRequest = state.pullRequests.find((pr) => pr.pr_number === prNumber);
      if (!pullRequest) {
        return { found: false };
      }
      if (pullRequest.status === "tested") {
        return { found: true, alreadyTested: true, pullRequest };
      }
      pullRequest.status = "tested";
      pullRequest.tested_by = testedBy;
      pullRequest.tested_at = new Date("2026-02-13T18:00:00.000Z");
      return { found: true, alreadyTested: false, pullRequest };
    },
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-999" }),
    insertDeploymentFn: async () => {
      const deploymentRecord = {
        deployed_at: new Date("2026-02-13T19:00:00.000Z"),
      };
      state.lastProductionDeploymentAt = deploymentRecord.deployed_at;
      state.deployments.push(deploymentRecord);
      return deploymentRecord;
    },
    markPullRequestsDeployedSinceFn: async (_pool, lastDeployAt, deployedAt) => {
      let deployedCount = 0;

      for (const pullRequest of state.pullRequests) {
        if (pullRequest.merged_at > lastDeployAt && pullRequest.status === "tested") {
          pullRequest.status = "deployed";
          pullRequest.deployed_at = deployedAt;
          deployedCount += 1;
        }
      }

      return deployedCount;
    },
  });

  assert.equal(app.commandName, "/calypso");

  const statusBefore = await runSlashCommand(commandHandler, "status", "U_TESTER");
  const deployBlocked = await runSlashCommand(commandHandler, "deploy prod", "U_TESTER");
  const markTested = await runSlashCommand(commandHandler, "tested 700", "U_TESTER");
  const deploySuccess = await runSlashCommand(commandHandler, "deploy prod", "U_TESTER");
  const statusAfter = await runSlashCommand(commandHandler, "status", "U_TESTER");

  assert.match(statusBefore.text, /Blocking PRs since last prod deploy/);
  assert.match(statusBefore.text, /#700 \(untested\)/);

  assert.match(deployBlocked.text, /Deploy blocked due to untested PRs/);
  assert.match(markTested.text, /Marked PR #700 as tested/);
  assert.equal(deploySuccess.response_type, "in_channel");
  assert.match(deploySuccess.text, /Deploy to prod is in progress \(id: dep-999\)/);
  assert.match(deploySuccess.text, /Triggered by U_TESTER/);
  assert.match(deploySuccess.text, /Marked 1 PR\(s\) deployed/);
  assert.match(statusAfter.text, /No blockers since last prod deploy/);

  assert.deepEqual(state.transactionStatements, ["BEGIN", "COMMIT"]);
  assert.equal(state.deployments.length, 1);
  assert.equal(state.pullRequests[0].status, "deployed");
  assert.equal(state.pullRequests[0].tested_by, "U_TESTER");
});

function createInMemoryState() {
  return {
    deployments: [],
    lastProductionDeploymentAt: new Date("1970-01-01T00:00:00.000Z"),
    pullRequests: [
      {
        merged_at: new Date("2026-02-13T17:00:00.000Z"),
        pr_number: 700,
        repo: "croft-eng/croft",
        status: "untested",
        title: "Feature PR",
      },
    ],
    transactionStatements: [],
  };
}

function createPoolTransactionRecorder(state) {
  return {
    async query(statement) {
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
        state.transactionStatements.push(statement);
      }
      return { rows: [] };
    },
  };
}

function createCommandHandler(serviceOptions) {
  const app = {
    commandName: null,
    commandHandler: null,
    command(name, handler) {
      this.commandName = name;
      this.commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, serviceOptions);

  return {
    app,
    commandHandler: app.commandHandler,
  };
}

async function runSlashCommand(commandHandler, text, userId) {
  let response;

  await commandHandler({
    command: {
      text,
      user_id: userId,
    },
    ack: async () => {},
    respond: async (message) => {
      response = message;
    },
  });

  return response;
}
