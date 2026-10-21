import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { MusicManager } from "../managers/MusicManager";
import { defineCommand } from "../utils/defineCommand";
import { requireQueue } from "../utils/music";

export const data = new SlashCommandBuilder().setName("stop").setDescription("Stop playing, clear the queue and leave").setContexts(0);

export async function execute(interaction: ChatInputCommandInteraction, registry: ManagerRegistry) {
  const queue = await requireQueue(interaction, registry.get<MusicManager>("MusicManager"));
  if (!queue) return;
  queue.stop();
  await interaction.reply("Stopped.");
}

export default defineCommand({ data, execute });
