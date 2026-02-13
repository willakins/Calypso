const { App } = require("@slack/bolt");

const { registerCalypsoCommand } = require("./commands/calypso");
const { loadConfig } = require("./config");

async function start() {
  const config = loadConfig();
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  registerCalypsoCommand(app);

  await app.start();
  console.log("Calypso is running in Socket Mode.");
}

start().catch((error) => {
  console.error("Failed to start Calypso.");
  console.error(error.message);
  process.exit(1);
});
