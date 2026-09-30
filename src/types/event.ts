import type { ClientEvents, Client } from "discord.js";
import type { ManagerRegistry } from "../core/ManagerRegistry";

export interface DiscordEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(registry: ManagerRegistry, client: Client, ...args: ClientEvents[K]): Promise<void> | void;
}
