import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { MusicManager } from "../managers/MusicManager";
import { trackLabel } from "../services/music/track";
import { defineCommand } from "../utils/defineCommand";
import { requireQueue } from "../utils/music";

export const data = new SlashCommandBuilder().setName("skip").setDescription("Skip the current track").setContexts(0);

export async function execute(interaction: ChatInputCommandInteraction, registry: ManagerRegistry) {
  const queue = await requireQueue(interaction, registry.get<MusicManager>("MusicManager"));
  if (!queue) return;
  const skipped = queue.current;
  queue.skip();
  await interaction.reply({ content: skipped ? `Skipped ${trackLabel(skipped)}.` : "Skipped.", allowedMentions: { parse: [] } });
}

export default defineCommand({ data, execute });
