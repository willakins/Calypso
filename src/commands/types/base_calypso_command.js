class BaseCalypsoCommand {
  constructor(commandName) {
    this.commandName = commandName;
  }

  getCommandName() {
    return this.commandName;
  }

  parse() {
    throw new Error(`${this.constructor.name} must implement parse()`);
  }

  async execute({ parsedCommand }) {
    return this.buildExecutionResult(parsedCommand.responseText || "Unsupported command.");
  }

  buildParsedCommand(fields) {
    return {
      commandName: this.getCommandName(),
      ...fields,
    };
  }

  buildRespondParsedCommand(responseText) {
    return this.buildParsedCommand({
      action: "respond",
      responseText,
    });
  }

  buildExecutionResult(responseText, additionalFields = {}) {
    return {
      responseText,
      ...additionalFields,
    };
  }
}

module.exports = {
  BaseCalypsoCommand,
};
