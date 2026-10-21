import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { GuildQueue, MusicManager } from "../managers/MusicManager";

// Shared guard for the queue-control commands: must be in a guild, a queue must
// exist, and the user must be in the same voice channel as the bot.
export async function requireQueue(
  interaction: ChatInputCommandInteraction,
  music: MusicManager,
): Promise<GuildQueue | null> {
  const queue = interaction.guildId ? music.get(interaction.guildId) : undefined;
  let problem: string | null = null;
  if (!queue) problem = "Nothing is playing.";
  else if (interaction.guild?.members.cache.get(interaction.user.id)?.voice.channelId !== queue.channelId) {
    problem = "Join my voice channel first.";
  }
  if (problem) {
    await interaction.reply({ content: problem, flags: MessageFlags.Ephemeral });
    return null;
  }
  return queue!;
}
