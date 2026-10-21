import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { LoopMode, MusicManager } from "../managers/MusicManager";
import { formatDuration, truncate } from "../services/media";
import { trackLabel, type Track } from "../services/music/track";
import { defineCommand } from "../utils/defineCommand";
import { requireQueue } from "../utils/music";

export const data = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show and control the music queue")
  .setContexts(0)
  .addSubcommand((s) => s.setName("show").setDescription("Show what's playing and what's next"))
  .addSubcommand((s) => s.setName("pause").setDescription("Pause playback"))
  .addSubcommand((s) => s.setName("resume").setDescription("Resume playback"))
  .addSubcommand((s) => s.setName("shuffle").setDescription("Shuffle the upcoming tracks"))
  .addSubcommand((s) => s.setName("clear").setDescription("Clear upcoming tracks (keeps the current one)"))
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove an upcoming track")
      .addIntegerOption((o) => o.setName("position").setDescription("Position in the queue").setMinValue(1).setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("loop")
      .setDescription("Repeat the current track or the whole queue")
      .addStringOption((o) =>
        o
          .setName("mode")
          .setDescription("Loop mode")
          .setRequired(true)
          .addChoices({ name: "off", value: "off" }, { name: "track", value: "track" }, { name: "queue", value: "queue" }),
      ),
  );

const line = (t: Track) => `${trackLabel(t)}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ""}`;

export function formatQueue(current: Track | null, upcoming: Track[], loop: LoopMode, paused: boolean): string {
  const lines: string[] = [];
  lines.push(current ? `${paused ? "Paused" : "Now playing"}: ${line(current)}` : "Nothing playing.");
  const shown = upcoming.slice(0, 15);
  shown.forEach((t, i) => lines.push(`${i + 1}. ${line(t)}`));
  if (upcoming.length > shown.length) lines.push(`...and ${upcoming.length - shown.length} more`);
  if (loop !== "off") lines.push(`Loop: ${loop}`);
  return truncate(lines.join("\n"), 1900);
}

export async function execute(interaction: ChatInputCommandInteraction, registry: ManagerRegistry) {
  const queue = await requireQueue(interaction, registry.get<MusicManager>("MusicManager"));
  if (!queue) return;
  const reply = (content: string) => interaction.reply({ content, allowedMentions: { parse: [] } });

  switch (interaction.options.getSubcommand()) {
    case "show":
      await reply(formatQueue(queue.current, queue.tracks, queue.loop, queue.paused));
      break;
    case "pause":
      queue.player.pause();
      await reply("Paused.");
      break;
    case "resume":
      queue.player.unpause();
      await reply("Resumed.");
      break;
    case "shuffle":
      queue.shuffle();
      await reply("Shuffled.");
      break;
    case "clear":
      queue.clear();
      await reply("Cleared.");
      break;
    case "remove": {
      const pos = interaction.options.getInteger("position", true);
      const [removed] = queue.tracks.splice(pos - 1, 1);
      if (!removed) {
        await interaction.reply({ content: "No track at that position.", flags: MessageFlags.Ephemeral });
        return;
      }
      await reply(`Removed ${trackLabel(removed)}.`);
      break;
    }
    case "loop":
      queue.loop = interaction.options.getString("mode", true) as LoopMode;
      await reply(`Loop: ${queue.loop}.`);
      break;
  }
}

export default defineCommand({ data, execute });
