const { BaseCalypsoCommand } = require("./base_command");

class EmailsCommand extends BaseCalypsoCommand {
  constructor() {
    super("emails");
  }

  parse({ commandWords }) {
    if (commandWords.length === 1) {
      return this.buildParsedCommand({
        action: "emails_list",
      });
    }

    if (commandWords.length === 3 && String(commandWords[1] || "").toLowerCase() === "responded") {
      const emailId = Number(commandWords[2]);
      if (!Number.isInteger(emailId) || emailId <= 0) {
        return this.buildRespondParsedCommand(buildUsageMessage());
      }

      return this.buildParsedCommand({
        action: "emails_responded",
        emailId,
      });
    }

    return this.buildRespondParsedCommand(buildUsageMessage());
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Emails command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText || buildUsageMessage());
    }

    if (parsedCommand.action === "emails_list") {
      const emailThreads = await runtime.listPendingSupportEmailThreadsFn(runtime.pool);
      if (emailThreads.length === 0) {
        return this.buildExecutionResult("No pending customer support emails.");
      }

      return this.buildExecutionResult(
        [
          "Pending customer support emails:",
          ...emailThreads.map(formatPendingSupportEmailLine),
        ].join("\n"),
      );
    }

    const respondedResult = await runtime.markSupportEmailThreadRespondedFn(
      runtime.pool,
      parsedCommand.emailId,
      runtime.userId,
    );
    if (!respondedResult.found) {
      return this.buildExecutionResult(`Support email [${parsedCommand.emailId}] not found.`);
    }

    if (respondedResult.alreadyResponded) {
      return this.buildExecutionResult(`Support email [${parsedCommand.emailId}] is already marked responded.`);
    }

    return this.buildExecutionResult(`Marked support email [${parsedCommand.emailId}] as responded.`);
  }
}

function buildUsageMessage() {
  return [
    "Usage:",
    "`/calypso emails`",
    "`/calypso emails responded <EMAIL_ID>`",
  ].join("\n");
}

function formatPendingSupportEmailLine(emailThread) {
  const emailId = emailThread.id;
  const sender = String(emailThread.first_sender || "").trim() || "unknown sender";
  const subject = String(emailThread.subject || "").trim() || "(no subject)";
  return `• [${emailId}] ${sender} | ${subject}`;
}

module.exports = {
  EmailsCommand,
};
