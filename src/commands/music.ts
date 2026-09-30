import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { searchDeezer, type DeezerType } from "../services/deezer";
import { defineCommand } from "../utils/defineCommand";
import { replyWithLookup } from "../utils/replyWithLookup";

export const data = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Look up a track, album or artist on Deezer")
  .addStringOption((o) => o.setName("query").setDescription("What to search for").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("Track (default), album or artist")
      .addChoices({ name: "track", value: "track" }, { name: "album", value: "album" }, { name: "artist", value: "artist" }),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  const type = (interaction.options.getString("type") ?? "track") as DeezerType;
  await replyWithLookup(interaction, query, () => searchDeezer(query, type));
}

export default defineCommand({ data, execute });
