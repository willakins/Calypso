const { parseCalypsoCommand } = require("./parsing/calypso_command_parser");
const { createCalypsoCommandService } = require("./services/calypso_command_service");

function handleCalypsoCommand({ text, user_id }) {
  void user_id;
  return parseCalypsoCommand({ text });
}

function registerCalypsoCommand(app, options = {}) {
  const calypsoCommandService = createCalypsoCommandService(options);

  app.command("/calypso", async ({ command, ack, respond }) => {
    await ack();

    try {
      const parsedCommand = parseCalypsoCommand({
        text: command.text,
      });

      const executionResult = await calypsoCommandService.execute(parsedCommand, {
        slackUserId: command.user_id,
      });

      await respond({
        response_type: "ephemeral",
        text: executionResult.responseText,
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
