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

      const executionResult = await calypsoCommandService.execute(parsedCommand, {
        slackUserId: command.user_id,
        slackClient: client,
      });

      await respond({
        response_type: "ephemeral",
        text: executionResult.responseText,
      });

      await sendDeploymentCompletionFollowUpIfNeeded({
        calypsoCommandService,
        command,
        executionResult,
        slackClient: client,
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
  command,
  executionResult,
  slackClient,
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
        slackClient,
        slackUserId: command.user_id,
      },
    );

    await respond({
      response_type: "ephemeral",
      text: `DigitalOcean deployment ${externalDeploymentId} finished successfully with phase ${completionState.phase}.`,
    });
  } catch (error) {
    await respond({
      response_type: "ephemeral",
      text: `DigitalOcean deployment ${externalDeploymentId} failed after trigger: ${error.message}`,
    });
  }
}

module.exports = {
  handleCalypsoCommand,
  registerCalypsoCommand,
};
