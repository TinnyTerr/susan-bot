import { MessageFlags, type GuildTextBasedChannel, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import { logger } from "../logger";
import type { MusicManager } from "../managers/MusicManager";
import { resolveInput } from "../services/music/resolve";
import { trackLabel } from "../services/music/track";
import { defineCommand } from "../utils/defineCommand";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a song, album or playlist in your voice channel")
  .setContexts(0)
  .addStringOption((o) =>
    o.setName("query").setDescription("YouTube/Spotify/Apple Music link, any yt-dlp URL, or search words").setRequired(true),
  )
  .addBooleanOption((o) => o.setName("next").setDescription("Put it at the front of the queue"));

export async function execute(interaction: ChatInputCommandInteraction, registry: ManagerRegistry) {
  const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel
    ?? (await interaction.guild?.members.fetch(interaction.user.id))?.voice.channel;
  if (!voice) {
    await interaction.reply({ content: "Join a voice channel first.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  const music = registry.get<MusicManager>("MusicManager");
  const query = interaction.options.getString("query", true);

  try {
    const resolved = await resolveInput(query);
    if (resolved.tracks.length === 0) {
      await interaction.editReply("Nothing found.");
      return;
    }

    const queue = await music.join(voice, interaction.channel?.isSendable() ? (interaction.channel as GuildTextBasedChannel) : null);
    const room = config.music.maxQueue - queue.tracks.length;
    if (room <= 0) {
      await interaction.editReply("The queue is full.");
      return;
    }
    const tracks = resolved.tracks.slice(0, room).map((t) => ({ ...t, requestedBy: interaction.user.id }));
    const wasIdle = !queue.playing;
    queue.add(tracks, interaction.options.getBoolean("next") ?? false);

    const msg =
      tracks.length === 1
        ? `${wasIdle ? "Starting" : "Queued"}: ${trackLabel(tracks[0]!)}`
        : `Queued ${tracks.length} tracks${resolved.collection ? ` from ${resolved.collection}` : ""}.`;
    await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error({ err, query }, "/play failed");
    await interaction.editReply({ content: `Couldn't play that: ${(err as Error).message}`, allowedMentions: { parse: [] } });
  }
}

export default defineCommand({ data, execute });
