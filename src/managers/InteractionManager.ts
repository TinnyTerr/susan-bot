import { join } from "node:path";
import type { ButtonInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { ComponentHandler } from "../types/interaction";
import { loadFiles } from "../utils/loadFiles";

// Routes button clicks and modal submits to the handler whose prefix claims
// the customId. Handler files live in src/interactions/ and default-export
// one handler or an array of them.
export class InteractionManager extends Manager {
  private handlers: ComponentHandler[] = [];

  constructor(client: Client, registry: ManagerRegistry) {
    super("InteractionManager", client, registry);
  }

  override async init(): Promise<void> {
    const loaded = await loadFiles<ComponentHandler | ComponentHandler[]>(
      join(import.meta.dir, "..", "interactions"),
    );
    this.handlers = loaded.flat();
    this.log.info({ prefixes: this.handlers.map((h) => `${h.kind}:${h.prefix}`) }, `Loaded ${this.handlers.length} component handler(s)`);
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    for (const h of this.handlers) {
      if (h.kind === "button" && interaction.customId.startsWith(h.prefix)) return void (await h.execute(interaction));
    }
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    for (const h of this.handlers) {
      if (h.kind === "modal" && interaction.customId.startsWith(h.prefix)) return void (await h.execute(interaction));
    }
  }
}
