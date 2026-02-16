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

  async checkCallerAccess(_context) {
    return this.allowAccess();
  }

  async execute({ parsedCommand }) {
    return this.buildExecutionResult(parsedCommand.responseText || "Unsupported command.");
  }

  resolveResponseType(_context) {
    return "ephemeral";
  }

  resolveFollowUpResponseType({ responseType }) {
    return responseType;
  }

  resolveAccessDeniedResponseType(_context) {
    return "ephemeral";
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

  allowAccess() {
    return {
      allowed: true,
    };
  }

  denyAccess(responseText) {
    return {
      allowed: false,
      responseText,
    };
  }
}

module.exports = {
  BaseCalypsoCommand,
};
