const { parseCalypsoCommand } = require("./parsing/calypso_command_parser");
const { createCalypsoCommandService } = require("./services/calypso_command_service");

function handleCalypsoCommand({ text, user_id }) {
  void user_id;
  return parseCalypsoCommand({ text });
}

function registerCalypsoCommand(app, options = {}) {
  const calypsoCommandService = createCalypsoCommandService(options);

  app.command("/calypso", async ({ client, command, ack, respond }) => {
    await ack();

    try {
      const parsedCommand = parseCalypsoCommand({
        text: command.text,
      });
      const userId = resolveCommandUserId(command);

      const executionResult = await calypsoCommandService.execute(parsedCommand, {
        userId,
        communicationClient: client,
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
        text: "Calypso hit an error while processing that command.",
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

module.exports = {
  handleCalypsoCommand,
  registerCalypsoCommand,
};
