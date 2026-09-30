import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { buildMediaEmbed } from "../mediaView";
import { logger } from "../logger";
import type { MediaResult } from "../services/media";

// Shared flow for the lookup commands: defer (APIs are slow), search, reply
// with the top hit, and keep failures ephemeral and readable.
export async function replyWithLookup(
  interaction: ChatInputCommandInteraction,
  query: string,
  search: () => Promise<MediaResult[]>,
) {
  await interaction.deferReply();
  try {
    const results = await search();
    if (results.length === 0) {
      await interaction.editReply(`No results for "${query}".`);
      return;
    }
    await interaction.editReply({ embeds: [buildMediaEmbed(results)], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error({ err, command: interaction.commandName, query }, "Media lookup failed");
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp({ content: "The lookup failed, try again in a bit.", flags: MessageFlags.Ephemeral });
  }
}
