import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";
import { searchTmdb, type TmdbType } from "../services/tmdb";
import { defineCommand } from "../utils/defineCommand";
import { replyWithLookup } from "../utils/replyWithLookup";

export const data = new SlashCommandBuilder()
  .setName("movie")
  .setDescription("Look up a movie or TV show on TMDB")
  .addStringOption((o) => o.setName("query").setDescription("Title to search for").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("Movie (default) or TV show")
      .addChoices({ name: "movie", value: "movie" }, { name: "tv", value: "tv" }),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!config.media.tmdbApiKey) {
    await interaction.reply({ content: "Movie lookups aren't set up (no TMDB_API_KEY).", flags: MessageFlags.Ephemeral });
    return;
  }
  const query = interaction.options.getString("query", true);
  const type = (interaction.options.getString("type") ?? "movie") as TmdbType;
  await replyWithLookup(interaction, query, () => searchTmdb(query, type, config.media.tmdbApiKey));
}

export default defineCommand({ data, execute });
