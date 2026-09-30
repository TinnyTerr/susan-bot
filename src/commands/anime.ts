import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { searchAniList, type AniListType } from "../services/anilist";
import { defineCommand } from "../utils/defineCommand";
import { replyWithLookup } from "../utils/replyWithLookup";

export const data = new SlashCommandBuilder()
  .setName("anime")
  .setDescription("Look up anime or manga on AniList")
  .addStringOption((o) => o.setName("query").setDescription("Title to search for").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("Anime (default) or manga")
      .addChoices({ name: "anime", value: "ANIME" }, { name: "manga", value: "MANGA" }),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  const type = (interaction.options.getString("type") ?? "ANIME") as AniListType;
  await replyWithLookup(interaction, query, () => searchAniList(query, type));
}

export default defineCommand({ data, execute });
