import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config";
import { db, type PromptRow, type QuiplashBoardRow } from "../db";
import { logger } from "../logger";
import { hasManagerRole } from "../permissions";
import { buildLatestPromptsEmbed, refreshQuiplashBoards } from "../quiplashView";

export const data = new SlashCommandBuilder()
  .setName("quiplash")
  .setDescription("Manage and draw prompts for Quiplash-style party games")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a single prompt")
      .addStringOption((o) =>
        o.setName("prompt").setDescription("The prompt text").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("category").setDescription("Category / pack name").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("import")
      .setDescription("Bulk-add prompts, one per line")
      .addStringOption((o) =>
        o
          .setName("prompts")
          .setDescription("Prompts separated by newlines (use \\n) or semicolons")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("category").setDescription("Category / pack name").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("random")
      .setDescription("Draw random prompts for a game")
      .addIntegerOption((o) =>
        o
          .setName("count")
          .setDescription(`How many prompts (default ${config.quiplash.randomDefaultCount})`)
          .setRequired(false),
      )
      .addStringOption((o) =>
        o.setName("category").setDescription("Limit to one category").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List stored prompts")
      .addStringOption((o) =>
        o.setName("category").setDescription("Limit to one category").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a prompt by ID")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Prompt ID").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("categories").setDescription("List all categories in use"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("latest")
      .setDescription("Post/refresh a pinned board of the latest prompts (managers only)")
      .addStringOption((o) =>
        o.setName("category").setDescription("Limit the board to one category").setRequired(false),
      ),
  );

function requireManager(interaction: ChatInputCommandInteraction): boolean {
  return hasManagerRole(interaction, config.quiplash.managerRoleIds);
}

function splitPrompts(raw: string): string[] {
  return raw
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "add") {
    if (!requireManager(interaction)) {
      await interaction.reply({ content: "You don't have permission to add prompts.", flags: MessageFlags.Ephemeral });
      return;
    }
    const text = interaction.options.getString("prompt", true);
    const category = (interaction.options.getString("category") ?? config.quiplash.defaultCategory).toLowerCase();

    const result = db
      .query(
        "INSERT INTO prompts (guildId, category, text, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)",
      )
      .run(guildId, category, text, interaction.user.id, Date.now());

    await refreshQuiplashBoards(interaction.client, guildId, category);

    await interaction.reply({
      content: `Added prompt #${Number(result.lastInsertRowid)} to **${category}**: "${text}"`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "import") {
    if (!requireManager(interaction)) {
      await interaction.reply({ content: "You don't have permission to add prompts.", flags: MessageFlags.Ephemeral });
      return;
    }
    const raw = interaction.options.getString("prompts", true);
    const category = (interaction.options.getString("category") ?? config.quiplash.defaultCategory).toLowerCase();
    const prompts = splitPrompts(raw);

    if (prompts.length === 0) {
      await interaction.reply({ content: "No valid prompts found in that input.", flags: MessageFlags.Ephemeral });
      return;
    }

    const insert = db.query(
      "INSERT INTO prompts (guildId, category, text, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)",
    );
    const now = Date.now();
    db.transaction(() => {
      for (const text of prompts) {
        insert.run(guildId, category, text, interaction.user.id, now);
      }
    })();

    await refreshQuiplashBoards(interaction.client, guildId, category);

    await interaction.reply({
      content: `Imported ${prompts.length} prompt(s) into **${category}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "random") {
    const requested = interaction.options.getInteger("count") ?? config.quiplash.randomDefaultCount;
    const count = Math.min(Math.max(requested, 1), config.quiplash.randomMaxCount);
    const category = interaction.options.getString("category")?.toLowerCase();

    let pool: PromptRow[];
    if (config.quiplash.avoidRepeats) {
      const cutoff = Date.now() - config.quiplash.cooldownHours * 3_600_000;
      pool = category
        ? db
            .query<PromptRow, [string, string, number]>(
              `SELECT p.* FROM prompts p WHERE p.guildId = ? AND p.category = ?
               AND p.id NOT IN (SELECT promptId FROM prompt_usage WHERE usedAt >= ?)`,
            )
            .all(guildId, category, cutoff)
        : db
            .query<PromptRow, [string, number]>(
              `SELECT p.* FROM prompts p WHERE p.guildId = ?
               AND p.id NOT IN (SELECT promptId FROM prompt_usage WHERE usedAt >= ?)`,
            )
            .all(guildId, cutoff);

      // If the no-repeat pool is too small, fall back to the full set.
      if (pool.length < count) {
        pool = category
          ? db
              .query<PromptRow, [string, string]>("SELECT * FROM prompts WHERE guildId = ? AND category = ?")
              .all(guildId, category)
          : db.query<PromptRow, [string]>("SELECT * FROM prompts WHERE guildId = ?").all(guildId);
      }
    } else {
      pool = category
        ? db
            .query<PromptRow, [string, string]>("SELECT * FROM prompts WHERE guildId = ? AND category = ?")
            .all(guildId, category)
        : db.query<PromptRow, [string]>("SELECT * FROM prompts WHERE guildId = ?").all(guildId);
    }

    if (pool.length === 0) {
      await interaction.reply({
        content: category
          ? `No prompts stored in category **${category}** yet.`
          : "No prompts stored yet. Add some with `/quiplash add`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, count);

    if (config.quiplash.avoidRepeats) {
      const markUsed = db.query("INSERT INTO prompt_usage (promptId, usedAt) VALUES (?, ?)");
      const now = Date.now();
      db.transaction(() => {
        for (const p of chosen) markUsed.run(p.id, now);
      })();
    }

    const lines = chosen.map((p, i) => `${i + 1}. ${p.text}`);
    await interaction.reply({ content: lines.join("\n") });
    return;
  }

  if (sub === "list") {
    const category = interaction.options.getString("category")?.toLowerCase();
    const prompts = category
      ? db
          .query<PromptRow, [string, string]>("SELECT * FROM prompts WHERE guildId = ? AND category = ? ORDER BY id ASC")
          .all(guildId, category)
      : db.query<PromptRow, [string]>("SELECT * FROM prompts WHERE guildId = ? ORDER BY id ASC").all(guildId);

    if (prompts.length === 0) {
      await interaction.reply({ content: "No prompts found.", flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = prompts.map((p) => `#${p.id} [${p.category}] ${p.text}`);
    const chunked = lines.join("\n").slice(0, 1900);
    await interaction.reply({
      content: chunked + (lines.join("\n").length > 1900 ? "\n… (truncated)" : ""),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    if (!requireManager(interaction)) {
      await interaction.reply({ content: "You don't have permission to remove prompts.", flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.options.getInteger("id", true);
    const prompt = db
      .query<PromptRow, [number, string]>("SELECT * FROM prompts WHERE id = ? AND guildId = ?")
      .get(id, guildId);

    if (!prompt) {
      await interaction.reply({ content: `No prompt #${id} found.`, flags: MessageFlags.Ephemeral });
      return;
    }

    db.query("DELETE FROM prompts WHERE id = ?").run(id);
    db.query("DELETE FROM prompt_usage WHERE promptId = ?").run(id);

    await refreshQuiplashBoards(interaction.client, guildId, prompt.category);

    await interaction.reply({ content: `Removed prompt #${id}: "${prompt.text}"`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "categories") {
    const rows = db
      .query<{ category: string; count: number }, [string]>(
        "SELECT category, COUNT(*) as count FROM prompts WHERE guildId = ? GROUP BY category ORDER BY category ASC",
      )
      .all(guildId);

    if (rows.length === 0) {
      await interaction.reply({ content: "No categories yet.", flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = rows.map((r) => `**${r.category}** — ${r.count} prompt(s)`);
    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "latest") {
    if (!requireManager(interaction)) {
      await interaction.reply({
        content: "You don't have permission to manage the latest-prompts board.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const category = interaction.options.getString("category")?.toLowerCase() ?? null;
    const embed = buildLatestPromptsEmbed(guildId, category);

    const existing = category
      ? db
          .query<QuiplashBoardRow, [string, string]>(
            "SELECT * FROM quiplash_boards WHERE guildId = ? AND category = ?",
          )
          .get(guildId, category)
      : db
          .query<QuiplashBoardRow, [string]>(
            "SELECT * FROM quiplash_boards WHERE guildId = ? AND category IS NULL",
          )
          .get(guildId);

    if (existing) {
      try {
        const channel = await interaction.client.channels.fetch(existing.channelId);
        if (channel && channel.isTextBased() && "messages" in channel) {
          const message = await channel.messages.fetch(existing.messageId);
          await message.edit({ embeds: [embed] });
          if (!message.pinned) await message.pin();
          await interaction.reply({
            content: `Refreshed the latest-prompts board in <#${existing.channelId}>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } catch {
        // old board message/channel is gone; fall through and recreate it
      }
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      await interaction.reply({
        content: "Can't post a board in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const message = await channel.send({ embeds: [embed] });
    try {
      await message.pin();
    } catch (err) {
      logger.error({ err }, "Failed to pin quiplash latest-prompts board");
    }

    if (existing) {
      db.query(
        "UPDATE quiplash_boards SET channelId = ?, messageId = ?, createdAt = ? WHERE id = ?",
      ).run(channel.id, message.id, Date.now(), existing.id);
    } else {
      db.query(
        "INSERT INTO quiplash_boards (guildId, channelId, messageId, category, createdAt) VALUES (?, ?, ?, ?, ?)",
      ).run(guildId, channel.id, message.id, category, Date.now());
    }

    await interaction.reply({
      content: `Posted and pinned the latest-prompts board in <#${channel.id}>. It'll stay updated automatically.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}
