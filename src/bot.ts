import { Bot } from "./client";
import { logger } from "./logger";

// Shard entry point, spawned by the shard manager (src/index.ts).
const bot = new Bot();
await bot.start();

// The manager kills this process (SIGTERM) on shutdown, and also to replace
// it after a restart request — shut the client down cleanly either way.
process.on("SIGTERM", async () => {
  logger.info("Shard received SIGTERM, shutting down");
  await bot.stop();
  process.exit(0);
});
