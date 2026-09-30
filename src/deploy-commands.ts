import { config } from "./config";
import { loadCommands, syncCommands } from "./managers/CommandManager";

async function main() {
  const commands = await loadCommands();
  await syncCommands(commands);
  if (config.guildId) {
    console.log(`Registered ${commands.length} commands to guild ${config.guildId} (stale ones removed).`);
  } else {
    console.log(`Registered ${commands.length} commands globally (stale ones removed; may take up to an hour to propagate).`);
  }
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
