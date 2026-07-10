import { Client, EmbedBuilder } from "discord.js";
import { config } from "./config";
import { db, type PromptRow, type QuiplashBoardRow } from "./db";

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

  return embed;
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
      await message.edit({ embeds: [buildLatestPromptsEmbed(guildId, board.category)] });
    } catch {
      // board message/channel no longer exists; leave the row, a fresh
      // /quiplash latest call will recreate it
    }
  }
}
