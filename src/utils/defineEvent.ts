import type { ClientEvents } from "discord.js";
import type { DiscordEvent } from "../types/event";

export function defineEvent<K extends keyof ClientEvents>(event: DiscordEvent<K>): DiscordEvent<K> {
  return event;
}
