import { config } from "./config";
import { commandData, syncCommands } from "./registerCommands";

async function main() {
  await syncCommands();
  if (config.guildId) {
    console.log(`Registered ${commandData.length} commands to guild ${config.guildId} (stale ones removed).`);
  } else {
    console.log(`Registered ${commandData.length} commands globally (stale ones removed; may take up to an hour to propagate).`);
  }
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
