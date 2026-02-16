const { createCalypsoCommandRegistry } = require("../registry/calypso_command_registry");

const registryByBotName = new Map();

function parseCalypsoCommand({ text, botName } = {}) {
  return getCommandRegistry(botName).parse({ text });
}

function getCommandRegistry(botName) {
  const normalizedBotName = String(botName || "").trim();
  const registryCacheKey = normalizedBotName || "__default__";

  if (!registryByBotName.has(registryCacheKey)) {
    registryByBotName.set(
      registryCacheKey,
      createCalypsoCommandRegistry({ botName: normalizedBotName || undefined }),
    );
  }

  return registryByBotName.get(registryCacheKey);
}

module.exports = {
  parseCalypsoCommand,
};
