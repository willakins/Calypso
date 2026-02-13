const { createCalypsoCommandRegistry } = require("../registry/calypso_command_registry");

const commandRegistry = createCalypsoCommandRegistry();

function parseCalypsoCommand({ text }) {
  return commandRegistry.parse({ text });
}

module.exports = {
  parseCalypsoCommand,
};
