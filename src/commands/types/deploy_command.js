const { BaseCalypsoCommand } = require("./base_command");
const { formatPullRequestReference } = require("../../util/format");

class DeployCommand extends BaseCalypsoCommand {
  constructor() {
    super("deploy");
  }

  parse({ commandWords }) {
    const hasEnvironmentArgument = commandWords.length === 2 || commandWords.length === 3;
    const environmentName = (commandWords[1] || "").toLowerCase();
    const forceWord = (commandWords[2] || "").toLowerCase();
    const isForceDeployWord = forceWord === "force" || forceWord === "forced";
    const hasValidForceArgument = commandWords.length === 2 || isForceDeployWord;
    const hasValidEnvironmentName = environmentName === "prod" || environmentName === "staging";
    const isValidDeployCommand =
      hasEnvironmentArgument && hasValidForceArgument && hasValidEnvironmentName;

    if (!isValidDeployCommand) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso deploy staging`",
          "`/calypso deploy prod`",
          "`/calypso deploy prod force`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: environmentName === "staging" ? "deploy_staging" : "deploy_prod",
      deployEnvironment: environmentName,
      forceDeployment: isForceDeployWord,
    });
  }

  async checkCallerAccess({ runtime }) {
    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Deploy denied.",
          "Only workspace admins or whitelisted users can deploy.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Deploy command unavailable: database pool is not configured.");
    }

    const deployEnvironment = this.resolveDeployEnvironment(parsedCommand);
    const isProductionDeploy = deployEnvironment === "prod";
    const forceDeployment = Boolean(parsedCommand.forceDeployment);
    const channelTopicGuardDecision = await this.evaluateChannelTopicGuard({
      runtime,
      deployEnvironment,
    });
    if (!channelTopicGuardDecision.isAllowed) {
      return this.buildExecutionResult(channelTopicGuardDecision.reasonText);
    }
    let deployGateState = {
      blockingPullRequests: [],
      lastProductionDeploymentAt: null,
    };
    let blockingPullRequestCount = 0;

    if (isProductionDeploy) {
      deployGateState = await this.readDeployGateState(runtime);
      blockingPullRequestCount = deployGateState.blockingPullRequests.length;

      if (blockingPullRequestCount > 0 && !forceDeployment) {
        return this.buildExecutionResult(
          [
            "Deploy blocked due to untested PRs:",
            ...deployGateState.blockingPullRequests.map(
              (pr) =>
                `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
            ),
          ].join("\n"),
        );
      }

      if (forceDeployment) {
        const forceDeployBlockedPullRequests = readForceDeployBlockedPullRequests(
          deployGateState.blockingPullRequests,
        );
        if (forceDeployBlockedPullRequests.length > 0) {
          return this.buildExecutionResult(
            [
              "Force deploy blocked.",
              "These PRs are marked as must-test and cannot be bypassed:",
              ...forceDeployBlockedPullRequests.map(
                (pr) =>
                  `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
              ),
              "Mark them tested with `/calypso tested <PR_NUMBER>` or clear the requirement with `/calypso must-test off <PR_NUMBER>`.",
            ].join("\n"),
          );
        }
      }
    }

    const deployConfiguration = this.resolveDeployConfiguration(
      runtime.deployConfig,
      deployEnvironment,
    );
    if (!this.hasDeployConfiguration(deployConfiguration)) {
      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy bypassed ${blockingPullRequestCount} blocking PR(s), but deploy not configured.`,
        );
      }

      if (isProductionDeploy) {
        return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.");
      }

      return this.buildExecutionResult("Deploy to staging is not configured.");
    }

    try {
      const deployResult = await runtime.triggerProdDeployFn(deployConfiguration);
      const deploymentTriggeredBy = await this.resolveDeploymentTriggeredBy(runtime);
      const deployProvider =
        deployResult.deployProvider || deployConfiguration.deployProvider || "digitalocean";
      let deploymentSummary = {
        deployedPullRequestCount: 0,
        deployedPullRequests: [],
        externalDeploymentId: deployResult.externalDeployId,
      };

      if (isProductionDeploy) {
        deploymentSummary = await this.recordDeploymentAndMarkPullRequests({
          runtime,
          lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
          externalDeploymentId: deployResult.externalDeployId,
          provider: deployProvider,
        });
      }

      const deploymentId = deploymentSummary.externalDeploymentId || "n/a";
      const shouldNotifyDeploymentCompletion =
        runtime.enableDeploymentCompletionNotifications &&
        Boolean(deploymentSummary.externalDeploymentId);
      const deployedPullRequestSummaryText = isProductionDeploy
        ? await this.buildDeployedPullRequestSummary({
            runtime,
            deployedPullRequestCount: deploymentSummary.deployedPullRequestCount,
            deployedPullRequests: deploymentSummary.deployedPullRequests,
          })
        : "";
      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          this.appendDeployedPullRequestSummary(
            `Force deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}. Bypassed ${blockingPullRequestCount} blocking PR(s). Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
            deployedPullRequestSummaryText,
          ),
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      if (!isProductionDeploy) {
        return this.buildExecutionResult(
          `Deploy to staging is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId: deploymentSummary.externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      return this.buildExecutionResult(
        this.appendDeployedPullRequestSummary(
          `Deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}. Marked ${deploymentSummary.deployedPullRequestCount} PR(s) deployed.`,
          deployedPullRequestSummaryText,
        ),
        this.buildDeploymentExecutionFields({
          externalDeploymentId: deploymentSummary.externalDeploymentId,
          deployProvider,
          shouldNotifyDeploymentCompletion,
          deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
        }),
      );
    } catch (error) {
      if (this.didDeploymentTransactionRollback(error)) {
        return this.buildExecutionResult(
          "Deploy failed while recording deployment state. Transaction was rolled back; no deploy records or PR statuses were committed.",
        );
      }

      return this.buildExecutionResult(
        `Deploy failed before deployment state was committed: ${error.message}`,
      );
    }
  }

  async readDeployGateState(runtime) {
    const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );

    return {
      blockingPullRequests,
      lastProductionDeploymentAt,
    };
  }

  hasDeployConfiguration(deployConfig) {
    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    const deployAppId = deployConfig.deployProductionAppId;
    const hasDigitalOceanConfig = Boolean(deployToken) && Boolean(deployAppId);
    const hasAwsConfig = Boolean(
      deployAppId &&
        deployConfig.deployRegion &&
        deployConfig.deployAccessKeyId &&
        deployConfig.deploySecretAccessKey,
    );

    return hasDigitalOceanConfig || hasAwsConfig;
  }

  resolveDeployEnvironment(parsedCommand) {
    const rawEnvironment = String(parsedCommand.deployEnvironment || "prod").trim().toLowerCase();
    if (rawEnvironment === "staging") {
      return "staging";
    }
    return "prod";
  }

  async evaluateChannelTopicGuard({ runtime, deployEnvironment }) {
    const resolveCurrentChannelTopicFn = runtime.resolveCurrentChannelTopicFn;
    if (typeof resolveCurrentChannelTopicFn !== "function") {
      return { isAllowed: true };
    }

    const channelTopic = await resolveCurrentChannelTopicFn(runtime);
    if (typeof channelTopic !== "string" || channelTopic.trim() === "") {
      return { isAllowed: true };
    }

    const topicStatus = readDeployAvailabilityFromTopic(channelTopic, deployEnvironment);
    if (topicStatus !== "blocked") {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      reasonText: [
        `Cannot deploy to ${deployEnvironment} from this channel right now.`,
        "Channel topic indicates deploy is not allowed for that environment (red status).",
      ].join(" "),
    };
  }

  resolveDeployConfiguration(deployConfig = {}, deployEnvironment = "prod") {
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;
    const deployStagingAppId = deployConfig.deployStagingAppId || deployConfig.doAppIdStaging;
    const selectedAppId =
      deployEnvironment === "staging" ? deployStagingAppId || "" : deployProductionAppId || "";

    return {
      ...deployConfig,
      deployTargetEnvironment: deployEnvironment,
      deployProductionAppId: selectedAppId,
    };
  }

  buildDeployConfigOverridesForCompletion(deployConfiguration) {
    return {
      deployTargetEnvironment: deployConfiguration.deployTargetEnvironment,
      deployProductionAppId: deployConfiguration.deployProductionAppId,
    };
  }

  async resolveDeploymentTriggeredBy(runtime) {
    const callerUserName = String(runtime.callerUserName || "").trim();
    if (callerUserName !== "") {
      return callerUserName;
    }

    const callerUserId = String(runtime.userId || "").trim();
    const resolveUserDisplayNameFn = runtime.resolveUserDisplayNameFn;
    if (callerUserId !== "" && typeof resolveUserDisplayNameFn === "function") {
      try {
        const displayName = await resolveUserDisplayNameFn(
          runtime.communicationClient,
          callerUserId,
        );
        const normalizedDisplayName = String(displayName || "").trim();
        if (normalizedDisplayName !== "") {
          return normalizedDisplayName;
        }
      } catch (_error) {
        // Ignore lookup failures and fall back to user id.
      }
    }

    if (callerUserId !== "") {
      return callerUserId;
    }

    return "unknown user";
  }

  async recordDeploymentAndMarkPullRequests({
    runtime,
    lastProductionDeploymentAt,
    externalDeploymentId,
    provider,
  }) {
    return this.withDatabaseTransaction(runtime.pool, async () => {
      const deploymentRecord = await runtime.insertDeploymentFn(runtime.pool, {
        environment: "prod",
        provider: provider || runtime.deployConfig.deployProvider || "digitalocean",
        externalDeployId: externalDeploymentId,
      });

      const deployedPullRequestMarkingResult = await runtime.markPullRequestsDeployedSinceFn(
        runtime.pool,
        lastProductionDeploymentAt,
        deploymentRecord.deployed_at,
      );
      const normalizedDeployedPullRequestMarkingResult =
        normalizeDeployedPullRequestMarkingResult(deployedPullRequestMarkingResult);

      return {
        deployedPullRequestCount:
          normalizedDeployedPullRequestMarkingResult.deployedPullRequestCount,
        deployedPullRequests:
          normalizedDeployedPullRequestMarkingResult.deployedPullRequests,
        externalDeploymentId,
      };
    });
  }

  appendDeployedPullRequestSummary(baseText, deployedPullRequestSummaryText) {
    const normalizedSummaryText = String(deployedPullRequestSummaryText || "").trim();
    if (normalizedSummaryText === "") {
      return baseText;
    }

    return `${baseText}\n${normalizedSummaryText}`;
  }

  async buildDeployedPullRequestSummary({
    runtime,
    deployedPullRequestCount,
    deployedPullRequests,
  }) {
    const normalizedDeployedPullRequests = normalizeDeployedPullRequests(deployedPullRequests);
    if (normalizedDeployedPullRequests.length === 0) {
      const parsedDeployedPullRequestCount = Number(deployedPullRequestCount);
      if (Number.isFinite(parsedDeployedPullRequestCount) && parsedDeployedPullRequestCount > 0) {
        return `Deployed PRs:\n• ${parsedDeployedPullRequestCount} PR(s) deployed (details unavailable).`;
      }
      return "Deployed PRs:\n• none.";
    }

    const githubUsernames = [...new Set(
      normalizedDeployedPullRequests
        .map((pullRequest) => normalizeGithubUsername(pullRequest.author_login))
        .filter(Boolean),
    )];
    const slackUsernameByGithubUsername = await this.resolveSlackUsernameByGithubUsername({
      runtime,
      githubUsernames,
    });

    return [
      "Deployed PRs:",
      ...normalizedDeployedPullRequests.map((pullRequest) =>
        formatDeployedPullRequestLine({
          pullRequest,
          slackUsernameByGithubUsername,
        }),
      ),
    ].join("\n");
  }

  async resolveSlackUsernameByGithubUsername({ runtime, githubUsernames }) {
    if (!runtime.pool || typeof runtime.listGithubSlackUserMappingsFn !== "function") {
      return new Map();
    }

    try {
      const githubToSlackUserMapping = await runtime.listGithubSlackUserMappingsFn(
        runtime.pool,
        githubUsernames,
      );
      return normalizeGithubToSlackUserMapping(githubToSlackUserMapping);
    } catch (_error) {
      return new Map();
    }
  }

  async withDatabaseTransaction(pool, transactionalWork) {
    let transactionStarted = false;

    try {
      await pool.query("BEGIN");
      transactionStarted = true;

      const result = await transactionalWork();

      await pool.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        await pool.query("ROLLBACK");
        throw this.buildRolledBackDeploymentError(error);
      }
      throw error;
    }
  }

  buildRolledBackDeploymentError(cause) {
    const rolledBackError = new Error("Deployment state transaction rolled back.", { cause });
    rolledBackError.code = "DEPLOY_STATE_ROLLED_BACK";
    return rolledBackError;
  }

  didDeploymentTransactionRollback(error) {
    return Boolean(error) && error.code === "DEPLOY_STATE_ROLLED_BACK";
  }

  resolveResponseType({ executionResult }) {
    return executionResult.deployTriggered ? "in_channel" : "ephemeral";
  }

  resolveFollowUpResponseType({ executionResult, responseType }) {
    if (executionResult.deployTriggered) {
      return "in_channel";
    }

    return responseType;
  }

  buildDeploymentExecutionFields({
    externalDeploymentId,
    deployProvider,
    shouldNotifyDeploymentCompletion,
    deployConfigOverrides,
  }) {
    return {
      deployTriggered: true,
      externalDeploymentId,
      deployProvider: deployProvider || null,
      deployConfigOverrides: deployConfigOverrides || {},
      shouldNotifyDeploymentCompletion,
    };
  }
}

function normalizeDeployedPullRequestMarkingResult(markingResult) {
  if (typeof markingResult === "number" && Number.isFinite(markingResult)) {
    return {
      deployedPullRequestCount: markingResult,
      deployedPullRequests: [],
    };
  }

  if (!markingResult || typeof markingResult !== "object") {
    return {
      deployedPullRequestCount: 0,
      deployedPullRequests: [],
    };
  }

  const deployedPullRequests = normalizeDeployedPullRequests(
    markingResult.deployedPullRequests || markingResult.pullRequests,
  );
  const parsedCount = Number(markingResult.deployedPullRequestCount);
  const deployedPullRequestCount = Number.isFinite(parsedCount)
    ? parsedCount
    : deployedPullRequests.length;

  return {
    deployedPullRequestCount,
    deployedPullRequests,
  };
}

function readForceDeployBlockedPullRequests(blockingPullRequests) {
  return (Array.isArray(blockingPullRequests) ? blockingPullRequests : []).filter((pullRequest) =>
    isForceDeployBlocked(pullRequest?.force_deploy_blocked),
  );
}

function isForceDeployBlocked(value) {
  if (value === true || value === 1 || value === "1") {
    return true;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  return normalizedValue === "true" || normalizedValue === "t";
}

function normalizeDeployedPullRequests(deployedPullRequests) {
  return (Array.isArray(deployedPullRequests) ? deployedPullRequests : [])
    .map((pullRequest) => ({
      repo: String(pullRequest?.repo || "").trim(),
      pr_number: pullRequest?.pr_number,
      title: String(pullRequest?.title || "").trim() || null,
      url: String(pullRequest?.url || "").trim() || null,
      author_login: String(pullRequest?.author_login || "").trim() || null,
    }))
    .filter((pullRequest) => Boolean(pullRequest.repo) && pullRequest.pr_number !== undefined);
}

function normalizeGithubToSlackUserMapping(githubToSlackUserMapping) {
  const mappings = new Map();
  if (githubToSlackUserMapping instanceof Map) {
    for (const [githubUsername, slackUsername] of githubToSlackUserMapping.entries()) {
      const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
      const normalizedSlackUsername = normalizeSlackUsername(slackUsername);
      if (normalizedGithubUsername && normalizedSlackUsername) {
        mappings.set(normalizedGithubUsername, normalizedSlackUsername);
      }
    }
    return mappings;
  }

  if (
    githubToSlackUserMapping &&
    typeof githubToSlackUserMapping === "object" &&
    !Array.isArray(githubToSlackUserMapping)
  ) {
    for (const [githubUsername, slackUsername] of Object.entries(githubToSlackUserMapping)) {
      const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
      const normalizedSlackUsername = normalizeSlackUsername(slackUsername);
      if (normalizedGithubUsername && normalizedSlackUsername) {
        mappings.set(normalizedGithubUsername, normalizedSlackUsername);
      }
    }
  }

  return mappings;
}

function normalizeGithubUsername(githubUsername) {
  const normalizedGithubUsername = String(githubUsername || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (normalizedGithubUsername === "") {
    return null;
  }

  return normalizedGithubUsername;
}

function normalizeSlackUsername(slackUsername) {
  const normalizedSlackReference = String(slackUsername || "").trim();
  const mentionMatch = normalizedSlackReference.match(/^<@([UW][A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  const userIdMatch = normalizedSlackReference.match(/^([UW][A-Z0-9]+)$/i);
  if (userIdMatch) {
    return userIdMatch[1].toUpperCase();
  }

  const normalizedSlackUsername = normalizedSlackReference
    .replace(/^@/, "")
    .toLowerCase();
  if (normalizedSlackUsername === "") {
    return null;
  }

  return normalizedSlackUsername;
}

function formatDeployedPullRequestLine({
  pullRequest,
  slackUsernameByGithubUsername,
}) {
  const pullRequestTitleReference = formatDeployedPullRequestTitleReference(pullRequest);
  const pullRequestAuthor = formatDeployedPullRequestAuthor({
    pullRequest,
    slackUsernameByGithubUsername,
  });
  return `• ${pullRequestTitleReference} by ${pullRequestAuthor}.`;
}

function formatDeployedPullRequestTitleReference(pullRequest) {
  const normalizedTitle = String(pullRequest?.title || "").trim();
  if (normalizedTitle && pullRequest?.url) {
    return `<${pullRequest.url}|${normalizedTitle}>`;
  }
  if (normalizedTitle) {
    return normalizedTitle;
  }

  return formatPullRequestReference({
    repo: pullRequest?.repo,
    prNumber: pullRequest?.pr_number,
    url: pullRequest?.url,
  });
}

function formatDeployedPullRequestAuthor({
  pullRequest,
  slackUsernameByGithubUsername,
}) {
  const normalizedGithubUsername = normalizeGithubUsername(pullRequest?.author_login);
  if (normalizedGithubUsername) {
    const mappedSlackUsername = slackUsernameByGithubUsername.get(normalizedGithubUsername);
    if (mappedSlackUsername) {
      if (isSlackUserId(mappedSlackUsername)) {
        return `<@${mappedSlackUsername}>`;
      }
      return `@${mappedSlackUsername}`;
    }

    return `${normalizedGithubUsername} (github username since no matching slack username)`;
  }

  return "unknown (github username since no matching slack username)";
}

function isSlackUserId(value) {
  return /^([UW][A-Z0-9]+)$/i.test(String(value || "").trim());
}

function readDeployAvailabilityFromTopic(topicText, deployEnvironment) {
  const rawTopic = String(topicText || "");
  const segment = readEnvironmentTopicSegment(rawTopic, deployEnvironment);
  if (!segment) {
    return "unknown";
  }

  const normalizedSegment = segment.toLowerCase();
  const hasRedStatus = [":red_circle:", ":large_red_circle:", "🔴"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasRedStatus) {
    return "blocked";
  }

  const hasGreenStatus = [":green_circle:", ":large_green_circle:", "🟢"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasGreenStatus) {
    return "allowed";
  }

  return "unknown";
}

function readEnvironmentTopicSegment(topicText, deployEnvironment) {
  const normalizedEnvironment = String(deployEnvironment || "").toLowerCase();
  const targetLabel =
    normalizedEnvironment === "prod" ? "(?:prod|production)" : "(?:staging)";
  const otherLabel =
    normalizedEnvironment === "prod" ? "(?:staging)" : "(?:prod|production)";
  const pattern = new RegExp(
    `\\b${targetLabel}\\b\\s*:\\s*(.*?)(?=\\b${otherLabel}\\b\\s*:|$)`,
    "i",
  );
  const match = String(topicText || "").match(pattern);
  return match?.[1] ? String(match[1]).trim() : "";
}

module.exports = {
  DeployCommand,
};
