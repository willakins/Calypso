const {
  getLastProdDeployAt,
  insertDeployment,
  listBlockingPullRequests,
  markPullRequestTested,
  markPullRequestsDeployedSince,
} = require("../db");
const { createDigitalOceanClient } = require("../integrations/digitalocean/client");
const { formatStatusResponse } = require("../util/format");

const HELP_TEXT = [
  "*Calypso*",
  "Slack deployment gatekeeper.",
  "",
  "*Usage*",
  "`/calypso help` Show this message.",
  "`/calypso status` Show deploy blockers since last prod deploy.",
  "`/calypso tested <PR_NUMBER>` Mark a PR as tested.",
  "`/calypso deploy prod` Attempt prod deploy after gate check.",
].join("\n");

function buildUnknownCommandMessage(input) {
  return [`Unknown subcommand: \`${input}\``, "Run `/calypso help` for usage."].join("\n");
}

async function triggerProdDeploy(deployConfig) {
  const client = createDigitalOceanClient({ token: deployConfig.digitaloceanToken });
  return client.triggerAppDeployment(deployConfig.doAppIdProd);
}

function handleCalypsoCommand({ text, user_id }) {
  void user_id;

  const normalizedText = (text || "").trim();
  const parts = normalizedText.split(/\s+/).filter(Boolean);
  const command = (parts[0] || "").toLowerCase();

  if (command === "") {
    return { action: "respond", responseText: HELP_TEXT };
  }

  if (command === "help") {
    return { action: "respond", responseText: HELP_TEXT };
  }

  if (command === "status") {
    return { action: "status" };
  }

  if (command === "tested") {
    const prNumber = Number(parts[1]);

    if (parts.length !== 2 || !Number.isInteger(prNumber) || prNumber <= 0) {
      return {
        action: "respond",
        responseText: "Usage: `/calypso tested <PR_NUMBER>`",
      };
    }

    return { action: "tested", prNumber };
  }

  if (command === "deploy") {
    if (parts.length === 2 && parts[1].toLowerCase() === "prod") {
      return { action: "deploy_prod" };
    }

    return {
      action: "respond",
      responseText: "Usage: `/calypso deploy prod`",
    };
  }

  return { action: "respond", responseText: buildUnknownCommandMessage(normalizedText) };
}

function registerCalypsoCommand(app, options = {}) {
  const {
    pool,
    getLastProdDeployAtFn = getLastProdDeployAt,
    listBlockingPullRequestsFn = listBlockingPullRequests,
    markPullRequestTestedFn = markPullRequestTested,
    insertDeploymentFn = insertDeployment,
    markPullRequestsDeployedSinceFn = markPullRequestsDeployedSince,
    triggerProdDeployFn = triggerProdDeploy,
    formatStatusResponseFn = formatStatusResponse,
    deployConfig = {},
  } = options;

  app.command("/calypso", async ({ command, ack, respond }) => {
    await ack();
    try {
      const result = handleCalypsoCommand({
        text: command.text,
        user_id: command.user_id,
      });

      if (result.action === "status") {
        if (!pool) {
          await respond({
            response_type: "ephemeral",
            text: "Status unavailable: database pool is not configured.",
          });
          return;
        }

        const lastDeployAt = await getLastProdDeployAtFn(pool);
        const blockers = await listBlockingPullRequestsFn(pool, lastDeployAt);

        await respond({
          response_type: "ephemeral",
          text: formatStatusResponseFn({ lastDeployAt, blockers }),
        });
        return;
      }

      if (result.action === "tested") {
        if (!pool) {
          await respond({
            response_type: "ephemeral",
            text: "Tested command unavailable: database pool is not configured.",
          });
          return;
        }

        const testedResult = await markPullRequestTestedFn(pool, result.prNumber, command.user_id);

        if (!testedResult.found) {
          await respond({
            response_type: "ephemeral",
            text: `PR #${result.prNumber} not found.`,
          });
          return;
        }

        if (testedResult.alreadyTested) {
          await respond({
            response_type: "ephemeral",
            text: `PR #${result.prNumber} is already marked tested.`,
          });
          return;
        }

        await respond({
          response_type: "ephemeral",
          text: `Marked PR #${result.prNumber} as tested.`,
        });
        return;
      }

      if (result.action === "deploy_prod") {
        if (!pool) {
          await respond({
            response_type: "ephemeral",
            text: "Deploy command unavailable: database pool is not configured.",
          });
          return;
        }

        const lastDeployAt = await getLastProdDeployAtFn(pool);
        const blockers = await listBlockingPullRequestsFn(pool, lastDeployAt);

        if (blockers.length > 0) {
          await respond({
            response_type: "ephemeral",
            text: [
              "Deploy blocked due to untested PRs:",
              ...blockers.map((pr) => `• ${pr.repo}#${pr.pr_number} (${pr.status})`),
            ].join("\n"),
          });
          return;
        }

        if (!deployConfig.digitaloceanToken || !deployConfig.doAppIdProd) {
          await respond({
            response_type: "ephemeral",
            text: "Deploy gate is clear, but deploy not configured.",
          });
          return;
        }

        const deployResult = await triggerProdDeployFn(deployConfig);
        let inTransaction = false;
        try {
          await pool.query("BEGIN");
          inTransaction = true;

          const deployment = await insertDeploymentFn(pool, {
            environment: "prod",
            provider: "digitalocean",
            externalDeployId: deployResult.externalDeployId,
          });

          const markedCount = await markPullRequestsDeployedSinceFn(
            pool,
            lastDeployAt,
            deployment.deployed_at,
          );

          await pool.query("COMMIT");
          inTransaction = false;

          await respond({
            response_type: "ephemeral",
            text: `Deploy triggered (id: ${deployResult.externalDeployId || "n/a"}). Marked ${markedCount} PR(s) deployed.`,
          });
          return;
        } catch (error) {
          if (inTransaction) {
            await pool.query("ROLLBACK");
          }
          throw error;
        }
      }

      await respond({
        response_type: "ephemeral",
        text: result.responseText,
      });
    } catch (error) {
      console.error("Failed to process /calypso command.");
      console.error(error.message);
      await respond({
        response_type: "ephemeral",
        text: "Calypso hit an error while processing that command.",
      });
    }
  });
}

module.exports = {
  handleCalypsoCommand,
  registerCalypsoCommand,
};
