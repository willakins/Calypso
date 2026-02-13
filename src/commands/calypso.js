const HELP_TEXT = [
  "*Calypso*",
  "Slack deployment gatekeeper.",
  "",
  "*Usage*",
  "`/calypso help` Show this message.",
].join("\n");

function buildUnknownCommandMessage(input) {
  return [`Unknown subcommand: \`${input}\``, "Run `/calypso help` for usage."].join("\n");
}

function registerCalypsoCommand(app) {
  app.command("/calypso", async ({ command, ack, respond }) => {
    await ack();

    const text = (command.text || "").trim();
    const normalized = text.toLowerCase();

    if (normalized === "" || normalized === "help") {
      await respond({
        response_type: "ephemeral",
        text: HELP_TEXT,
      });
      return;
    }

    await respond({
      response_type: "ephemeral",
      text: buildUnknownCommandMessage(text),
    });
  });
}

module.exports = {
  registerCalypsoCommand,
};
