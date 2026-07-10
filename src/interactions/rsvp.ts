import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db, type EventRow, type RsvpRow } from "../db";
import { buildEventComponents, buildEventEmbed } from "../eventView";

function getEvent(eventId: number): EventRow | undefined {
  return db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(eventId) ?? undefined;
}

async function refreshMessage(interaction: ButtonInteraction | ModalSubmitInteraction, event: EventRow) {
  if (!event.messageId) return;
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return;
  try {
    const message = await channel.messages.fetch(event.messageId);
    await message.edit({
      embeds: [buildEventEmbed(event)],
      components: buildEventComponents(event.id),
    });
  } catch {
    // ignore if message was deleted
  }
}

export async function handleRsvpButton(interaction: ButtonInteraction) {
  const [, action, eventIdRaw] = interaction.customId.split(":");
  const eventId = Number(eventIdRaw);
  const event = getEvent(eventId);

  if (!event || event.cancelled) {
    await interaction.reply({
      content: "This event no longer exists or was cancelled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "details") {
    const existing = db
      .query<RsvpRow, [number, string]>("SELECT * FROM rsvps WHERE eventId = ? AND userId = ?")
      .get(eventId, interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId(`rsvp-modal:${eventId}`)
      .setTitle(`RSVP details — ${event.name}`.slice(0, 45));

    const arrivalInput = new TextInputBuilder()
      .setCustomId("arrival")
      .setLabel("When can you get there?")
      .setPlaceholder('e.g. "7:30pm" or "a bit late"')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(existing?.arrival ?? "");

    const departureInput = new TextInputBuilder()
      .setCustomId("departure")
      .setLabel("When do you need to leave?")
      .setPlaceholder('e.g. "10pm" or "whenever it wraps up"')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(existing?.departure ?? "");

    const noteInput = new TextInputBuilder()
      .setCustomId("note")
      .setLabel("Anything else? (bringing food, +1, etc.)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(existing?.note ?? "");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(arrivalInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(departureInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput),
    );

    await interaction.showModal(modal);
    return;
  }

  if (action === "yes" || action === "maybe" || action === "no") {
    const now = Date.now();
    db.query(
      `INSERT INTO rsvps (eventId, userId, status, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(eventId, userId) DO UPDATE SET status = excluded.status, updatedAt = excluded.updatedAt`,
    ).run(eventId, interaction.user.id, action, now);

    const updated = getEvent(eventId)!;
    await interaction.update({
      embeds: [buildEventEmbed(updated)],
      components: buildEventComponents(eventId),
    });
    return;
  }
}

export async function handleRsvpModalSubmit(interaction: ModalSubmitInteraction) {
  const [, eventIdRaw] = interaction.customId.split(":");
  const eventId = Number(eventIdRaw);
  const event = getEvent(eventId);

  if (!event || event.cancelled) {
    await interaction.reply({
      content: "This event no longer exists or was cancelled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const arrival = interaction.fields.getTextInputValue("arrival").trim() || null;
  const departure = interaction.fields.getTextInputValue("departure").trim() || null;
  const note = interaction.fields.getTextInputValue("note").trim() || null;
  const now = Date.now();

  const existing = db
    .query<RsvpRow, [number, string]>("SELECT * FROM rsvps WHERE eventId = ? AND userId = ?")
    .get(eventId, interaction.user.id);

  // Filling in details implies attendance unless the user already explicitly declined.
  const status = existing?.status === "no" ? "no" : existing?.status ?? "yes";

  db.query(
    `INSERT INTO rsvps (eventId, userId, status, arrival, departure, note, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(eventId, userId) DO UPDATE SET
       status = excluded.status, arrival = excluded.arrival,
       departure = excluded.departure, note = excluded.note, updatedAt = excluded.updatedAt`,
  ).run(eventId, interaction.user.id, status, arrival, departure, note, now);

  await refreshMessage(interaction, getEvent(eventId)!);

  await interaction.reply({
    content: "Your RSVP details were saved.",
    flags: MessageFlags.Ephemeral,
  });
}
