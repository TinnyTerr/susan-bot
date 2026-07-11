import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import * as chrono from "chrono-node";
import { config } from "./../config";
import { db, type EventRow } from "./../db";
import { buildEventComponents, buildEventEmbed } from "./../eventView";
import { discordTimestamp } from "./../formatting";
import { logger } from "./../logger";
import { hasManagerRole } from "./../permissions";

export const data = new SlashCommandBuilder()
  .setName("event")
  .setDescription("Schedule and manage hangouts / events")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Schedule a new event")
      .addStringOption((o) =>
        o.setName("name").setDescription("Event name").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("when")
          .setDescription('When it happens, e.g. "next Friday 7pm" or "2026-08-01 19:00"')
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("description").setDescription("Details about the event").setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to post the event in (defaults to this channel)")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List upcoming events"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("info")
      .setDescription("Show details for one event")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Event ID").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel an event")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Event ID").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("resend")
      .setDescription("Resend and pin an event's embed (event managers only)")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Event ID").setRequired(true),
      ),
  );

function requireManager(interaction: ChatInputCommandInteraction): boolean {
  if (hasManagerRole(interaction, config.events.managerRoleIds)) return true;
  return false;
}

async function repostEvent(interaction: ChatInputCommandInteraction, event: EventRow) {
  const channel = await interaction.client.channels.fetch(event.channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;
  if (!event.messageId) return;
  try {
    const message = await channel.messages.fetch(event.messageId);
    await message.edit({
      embeds: [buildEventEmbed(event)],
      components: buildEventComponents(event.id),
    });
  } catch {
    // message may have been deleted; ignore
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    if (!requireManager(interaction)) {
      await interaction.reply({
        content: "You don't have permission to create events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const name = interaction.options.getString("name", true);
    const when = interaction.options.getString("when", true);
    const description = interaction.options.getString("description") ?? null;
    const channelOption = interaction.options.getChannel("channel");

    const channelId =
      channelOption?.id ?? config.events.defaultChannelId ?? interaction.channelId;

    const parsed = chrono.parseDate(when, new Date(), { forwardDate: true });
    if (!parsed) {
      await interaction.reply({
        content: `Couldn't understand the date/time "${when}". Try something like "next Friday 7pm" or "2026-08-01 19:00".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const startTime = parsed.getTime();
    const now = Date.now();

    const insert = db.query(
      `INSERT INTO events (guildId, channelId, messageId, name, description, startTime, creatorId, createdAt, cancelled)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0)`,
    );
    const result = insert.run(
      interaction.guildId!,
      channelId,
      name,
      description,
      startTime,
      interaction.user.id,
      now,
    );
    const eventId = Number(result.lastInsertRowid);

    const event = db
      .query<EventRow, [number]>("SELECT * FROM events WHERE id = ?")
      .get(eventId)!;

    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      await interaction.reply({
        content: "That channel isn't a text channel I can post in.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const message = await channel.send({
      embeds: [buildEventEmbed(event)],
      components: buildEventComponents(event.id),
    });

    let threadId: string | null = null;
    if ("threads" in channel) {
      try {
        const thread = await message.startThread({
          name: name.slice(0, 100),
          autoArchiveDuration: config.events.threadAutoArchiveMinutes as 60 | 1440 | 4320 | 10080,
        });
        threadId = thread.id;
        await thread.send(
          `RSVP above, and use this thread to chat about **${name}**.`,
        );
      } catch (err) {
        logger.error({ err }, "Failed to create event thread");
      }
    }

    db.query("UPDATE events SET messageId = ?, threadId = ? WHERE id = ?").run(
      message.id,
      threadId,
      eventId,
    );

    await interaction.reply({
      content: `Event **${name}** scheduled for ${discordTimestamp(startTime, "F")} in <#${channelId}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const now = Date.now();
    const events = db
      .query<
        EventRow,
        [string, number, number]
      >(
        `SELECT * FROM events WHERE guildId = ? AND cancelled = 0 AND startTime >= ?
         ORDER BY startTime ASC LIMIT ?`,
      )
      .all(interaction.guildId!, now, config.events.listMax);

    if (events.length === 0) {
      await interaction.reply({
        content: "No upcoming events. Create one with `/event create`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = events.map(
      (e) => `**#${e.id} ${e.name}** — ${discordTimestamp(e.startTime, "R")} (${discordTimestamp(e.startTime, "f")})`,
    );

    await interaction.reply({
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "info") {
    const id = interaction.options.getInteger("id", true);
    const event = db
      .query<EventRow, [number, string]>("SELECT * FROM events WHERE id = ? AND guildId = ?")
      .get(id, interaction.guildId!);

    if (!event) {
      await interaction.reply({ content: `No event #${id} found.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      embeds: [buildEventEmbed(event)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "cancel") {
    if (!requireManager(interaction)) {
      await interaction.reply({
        content: "You don't have permission to cancel events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const id = interaction.options.getInteger("id", true);
    const event = db
      .query<EventRow, [number, string]>("SELECT * FROM events WHERE id = ? AND guildId = ?")
      .get(id, interaction.guildId!);

    if (!event) {
      await interaction.reply({ content: `No event #${id} found.`, flags: MessageFlags.Ephemeral });
      return;
    }

    db.query("UPDATE events SET cancelled = 1 WHERE id = ?").run(id);
    const updated = db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(id)!;
    await repostEvent(interaction, updated);

    if (updated.threadId) {
      try {
        const thread = await interaction.client.channels.fetch(updated.threadId);
        if (thread?.isThread()) {
          await thread.send(`This event was cancelled by <@${interaction.user.id}>.`);
          await thread.setArchived(true);
          await thread.setLocked(true);
        }
      } catch (err) {
        logger.error({ err }, "Failed to archive event thread on cancel");
      }
    }

    await interaction.reply({
      content: `Event #${id} (${event.name}) cancelled.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "resend") {
    if (!requireManager(interaction)) {
      await interaction.reply({
        content: "You don't have permission to resend events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const id = interaction.options.getInteger("id", true);
    const event = db
      .query<EventRow, [number, string]>("SELECT * FROM events WHERE id = ? AND guildId = ?")
      .get(id, interaction.guildId!);

    if (!event) {
      await interaction.reply({ content: `No event #${id} found.`, flags: MessageFlags.Ephemeral });
      return;
    }

    let channel = null;
    try {
      const fetched = await interaction.client.channels.fetch(event.channelId);
      if (fetched && fetched.isTextBased() && "send" in fetched) channel = fetched;
    } catch {
      // original channel was likely deleted; fall back below
    }

    let usedFallbackChannel = false;
    if (!channel) {
      const current = interaction.channel;
      if (current && current.isTextBased() && "send" in current) {
        channel = current;
        usedFallbackChannel = true;
      } else {
        await interaction.reply({
          content: "That event's channel is gone, and I can't post in this one either.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (!usedFallbackChannel && event.messageId) {
      try {
        const oldMessage = await channel.messages.fetch(event.messageId);
        if (oldMessage.pinned) await oldMessage.unpin();
        // Strip buttons so old RSVP clicks can't desync from the new pinned
        // message, which becomes the sole up-to-date copy of this event.
        await oldMessage.edit({
          content: "This event has been reposted — see the pinned message below.",
          embeds: [buildEventEmbed(event)],
          components: [],
        });
      } catch {
        // old message may already be gone; ignore
      }
    }

    const message = await channel.send({
      embeds: [buildEventEmbed(event)],
      components: buildEventComponents(event.id),
    });

    db.query("UPDATE events SET messageId = ?, channelId = ? WHERE id = ?").run(
      message.id,
      channel.id,
      id,
    );

    await interaction.reply({
      content: usedFallbackChannel
        ? `The original channel for event #${id} (${event.name}) is gone, so I reposted and pinned it here in <#${channel.id}> instead.`
        : `Resent and pinned event #${id} (${event.name}) in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}
