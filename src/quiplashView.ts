import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
} from "discord.js";
import { config } from "./config";
import { db, type PromptRow, type QuiplashBoardRow } from "./db";

const LEADERBOARD_SIZE = 5;

// Top contributors by total prompts added, across every category — this is
// deliberately unfiltered even on a per-category board, since the ask is
// "who's added the most prompts overall."
function buildLeaderboardText(guildId: string): string {
  const rows = db
    .query<{ addedBy: string; count: number }, [string, number]>(
      "SELECT addedBy, COUNT(*) as count FROM prompts WHERE guildId = ? GROUP BY addedBy ORDER BY count DESC LIMIT ?",
    )
    .all(guildId, LEADERBOARD_SIZE);

  if (rows.length === 0) return "No prompts yet.";
  return rows.map((r, i) => `${i + 1}. <@${r.addedBy}> — ${r.count} prompt(s)`).join("\n");
}

export function buildLatestPromptsEmbed(guildId: string, category: string | null): EmbedBuilder {
  const count = config.quiplash.latestDefaultCount;
  const prompts = category
    ? db
        .query<PromptRow, [string, string, number]>(
          "SELECT * FROM prompts WHERE guildId = ? AND category = ? ORDER BY id DESC LIMIT ?",
        )
        .all(guildId, category, count)
    : db
        .query<PromptRow, [string, number]>(
          "SELECT * FROM prompts WHERE guildId = ? ORDER BY id DESC LIMIT ?",
        )
        .all(guildId, count);

  const embed = new EmbedBuilder()
    .setTitle(category ? `Latest Quiplash Prompts — ${category}` : "Latest Quiplash Prompts")
    .setTimestamp(Date.now());

  embed.setDescription(
    prompts.length === 0
      ? "No prompts stored yet."
      : prompts
          .map((p) => `#${p.id} [${p.category}] ${p.text}`)
          .join("\n")
          .slice(0, 4000),
  );

  embed.addFields({ name: "Top Contributors", value: buildLeaderboardText(guildId) });

  return embed;
}

export function buildQuiplashBoardComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const button = new ButtonBuilder()
    .setCustomId("quiplash:add-modal")
    .setLabel("Add Prompt")
    .setStyle(ButtonStyle.Primary);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

// Re-renders every stored "latest prompts" board for a guild whose category
// matches the one that just changed (or the all-categories board, which
// tracks every change) so the pinned message always reflects current data.
export async function refreshQuiplashBoards(
  client: Client,
  guildId: string,
  category: string,
): Promise<void> {
  const boards = db
    .query<QuiplashBoardRow, [string]>("SELECT * FROM quiplash_boards WHERE guildId = ?")
    .all(guildId);

  for (const board of boards) {
    if (board.category !== null && board.category !== category) continue;
    try {
      const channel = await client.channels.fetch(board.channelId);
      if (!channel || !channel.isTextBased() || !("messages" in channel)) continue;
      const message = await channel.messages.fetch(board.messageId);
      await message.edit({
        embeds: [buildLatestPromptsEmbed(guildId, board.category)],
        components: buildQuiplashBoardComponents(),
      });
    } catch {
      // board message/channel no longer exists; leave the row, a fresh
      // /quiplash latest call will recreate it
    }
  }
}
