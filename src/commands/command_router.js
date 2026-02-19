const { parseCalypsoCommand } = require("./parsing/command_parser");
const { createCalypsoCommandService } = require("./services/command_service");
const { DEFAULT_BOT_NAME } = require("../config");

function handleCalypsoCommand({ text, user_id, botName }) {
  void user_id;
  return parseCalypsoCommand({ text, botName });
}

function registerCalypsoCommand(app, options = {}) {
  const botName = resolveBotName(options.botName);
  const calypsoCommandService = createCalypsoCommandService(options);

  app.command("/calypso", async ({ client, command, ack, respond }) => {
    await ack();

    try {
      const parsedCommand = parseCalypsoCommand({
        text: command.text,
        botName,
      });
      const userId = resolveCommandUserId(command);

      const executionResult = await calypsoCommandService.execute(parsedCommand, {
        userId,
        communicationClient: client,
        currentChannelId: resolveCommandChannelId(command),
        currentChannelName: resolveCommandChannelName(command),
      });

      await respond({
        response_type: normalizeResponseType(executionResult.responseType),
        text: executionResult.responseText,
      });

      await sendDeploymentCompletionFollowUpIfNeeded({
        calypsoCommandService,
        userId,
        executionResult,
        communicationClient: client,
        respond,
      });
    } catch (error) {
      console.error("Failed to process /calypso command.");
      console.error(error.message);
      await respond({
        response_type: "ephemeral",
        text: `${botName} hit an error while processing that command.`,
      });
    }
  });
}

async function sendDeploymentCompletionFollowUpIfNeeded({
  calypsoCommandService,
  communicationClient,
  executionResult,
  userId,
  respond,
}) {
  const shouldNotifyCompletion = Boolean(executionResult.shouldNotifyDeploymentCompletion);
  const externalDeploymentId = executionResult.externalDeploymentId || null;
  if (!shouldNotifyCompletion || !externalDeploymentId) {
    return;
  }

  try {
    const completionState = await calypsoCommandService.waitForProdDeploymentCompletion(
      externalDeploymentId,
      {
        communicationClient,
        deployConfig: executionResult.deployConfigOverrides || {},
        deployProvider: executionResult.deployProvider,
        userId,
      },
    );

    await respond({
      response_type: normalizeResponseType(
        executionResult.followUpResponseType || executionResult.responseType,
      ),
      text: `Deployment ${externalDeploymentId} finished successfully with phase ${completionState.phase}.`,
    });
  } catch (error) {
    await respond({
      response_type: normalizeResponseType(
        executionResult.followUpResponseType || executionResult.responseType,
      ),
      text: `Deployment ${externalDeploymentId} failed after trigger: ${error.message}`,
    });
  }
}

function normalizeResponseType(responseType) {
  return responseType === "in_channel" ? "in_channel" : "ephemeral";
}

function resolveCommandUserId(command) {
  if (!command) {
    return null;
  }

  return command.userId || command.user_id || null;
}

function resolveCommandChannelId(command) {
  if (!command) {
    return null;
  }

  return command.channelId || command.channel_id || null;
}

function resolveCommandChannelName(command) {
  if (!command) {
    return null;
  }

  return command.channelName || command.channel_name || null;
}

function resolveBotName(botName) {
  const normalizedBotName = String(botName || "").trim();
  return normalizedBotName || DEFAULT_BOT_NAME;
}

module.exports = {
  handleCalypsoCommand,
  registerCalypsoCommand,
};
