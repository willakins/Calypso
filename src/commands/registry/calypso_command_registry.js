const { ConfigCommand } = require("../types/config_command");
const { DeployCommand } = require("../types/deploy_command");
const { HelpCommand } = require("../types/help_command");
const { StatusCommand } = require("../types/status_command");
const { TestedCommand } = require("../types/tested_command");
const { UnknownCommand } = require("../types/unknown_command");
const { WhitelistCommand } = require("../types/whitelist_command");

function createCalypsoCommandRegistry() {
  return new CalypsoCommandRegistry({
    commandDefinitions: [
      new HelpCommand(),
      new ConfigCommand(),
      new StatusCommand(),
      new TestedCommand(),
      new DeployCommand(),
      new WhitelistCommand(),
    ],
    fallbackCommand: new UnknownCommand(),
  });
}

class CalypsoCommandRegistry {
  constructor({ commandDefinitions, fallbackCommand }) {
    this.fallbackCommand = fallbackCommand;
    this.commandsByName = new Map(
      commandDefinitions.map((commandDefinition) => [
        commandDefinition.getCommandName(),
        commandDefinition,
      ]),
    );
  }

  parse({ text }) {
    const normalizedText = sanitizeCommandText(text);
    const commandWords = splitIntoWords(normalizedText);
    const commandName = resolveCommandName(commandWords);
    const commandDefinition =
      this.commandsByName.get(commandName) || this.fallbackCommand;

    return commandDefinition.parse({
      commandWords,
      commandText: normalizedText,
    });
  }

  async execute(parsedCommand, runtime) {
    const commandDefinition =
      this.commandsByName.get(parsedCommand.commandName) || this.fallbackCommand;

    const accessDecision = await commandDefinition.checkCallerAccess({
      parsedCommand,
      runtime,
    });
    if (!accessDecision.allowed) {
      return {
        responseText: accessDecision.responseText || "Access denied for this command.",
      };
    }

    return commandDefinition.execute({
      parsedCommand,
      runtime,
    });
  }
}

function splitIntoWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

function sanitizeCommandText(text) {
  const rawText = typeof text === "string" ? text : "";
  const withoutControlChars = rawText.replace(/[\u0000-\u001F\u007F]/g, " ");
  return withoutControlChars.replace(/\s+/g, " ").trim();
}

function resolveCommandName(commandWords) {
  const keyword = (commandWords[0] || "").toLowerCase();
  return keyword === "" ? "help" : keyword;
}

module.exports = {
  createCalypsoCommandRegistry,
};
