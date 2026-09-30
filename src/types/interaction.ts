import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";

interface BaseHandler {
  // Handler claims any customId that starts with this.
  prefix: string;
}

export interface ButtonHandler extends BaseHandler {
  kind: "button";
  execute(interaction: ButtonInteraction): Promise<void> | void;
}

export interface ModalHandler extends BaseHandler {
  kind: "modal";
  execute(interaction: ModalSubmitInteraction): Promise<void> | void;
}

export type ComponentHandler = ButtonHandler | ModalHandler;
