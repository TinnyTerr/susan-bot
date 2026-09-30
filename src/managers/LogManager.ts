import type { Client } from "discord.js";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import { setLoggerClient } from "../discordLogger";

// Hands the live client to discordLogger so update/error logs can be mirrored
// to LOG_CHANNEL_ID. Console logging itself goes through pino (src/logger.ts).
export class LogManager extends Manager {
  constructor(client: Client, registry: ManagerRegistry) {
    super("LogManager", client, registry);
  }

  override async ready(): Promise<void> {
    setLoggerClient(this.client as Client<true>);
  }
}
