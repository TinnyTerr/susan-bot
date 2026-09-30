import { join } from "node:path";
import type { Client } from "discord.js";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { DiscordEvent } from "../types/event";
import { loadFiles } from "../utils/loadFiles";

export class EventManager extends Manager {
  private events: DiscordEvent[] = [];

  constructor(client: Client, registry: ManagerRegistry) {
    super("EventManager", client, registry);
  }

  override async init(): Promise<void> {
    this.events = await loadFiles<DiscordEvent>(join(import.meta.dir, "..", "events"));

    for (const event of this.events) {
      const handler = (...args: unknown[]) => {
        this.registry.bus.emit(`discord:${String(event.name)}`, ...args);
        void Promise.resolve(event.execute(this.registry, this.client, ...(args as never))).catch((err) =>
          this.log.error({ err, event: String(event.name) }, "Event handler threw"),
        );
      };

      if (event.once) this.client.once(event.name, handler);
      else this.client.on(event.name, handler);
    }

    this.log.info({ names: this.events.map((e) => String(e.name)) }, `Loaded ${this.events.length} event handler(s)`);
  }
}
