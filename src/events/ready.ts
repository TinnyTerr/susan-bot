import { Events } from "discord.js";
import { logger } from "../logger";
import { defineEvent } from "../utils/defineEvent";

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  execute(_registry, client) {
    logger.info({ tag: client.user?.tag, shard: client.shard?.ids ?? null }, "Logged in");
  },
});
