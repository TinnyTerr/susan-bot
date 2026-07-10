import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { config } from "./config";
import { db, type EventRow, type RsvpRow } from "./db";
import { discordTimestamp } from "./formatting";

function rsvpButton(id: string, label: string, emoji: string, style: ButtonStyle): ButtonBuilder {
  const button = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) button.setEmoji(emoji);
  return button;
}

export function buildEventComponents(eventId: number): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    rsvpButton(`rsvp:yes:${eventId}`, "Going", config.events.rsvpEmoji.yes, ButtonStyle.Success),
    rsvpButton(`rsvp:maybe:${eventId}`, "Maybe", config.events.rsvpEmoji.maybe, ButtonStyle.Secondary),
    rsvpButton(`rsvp:no:${eventId}`, "Can't go", config.events.rsvpEmoji.no, ButtonStyle.Danger),
  );

  if (config.events.advancedRsvpEnabled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`rsvp:details:${eventId}`)
        .setLabel("Arrival / Departure")
        .setStyle(ButtonStyle.Primary),
    );
  }

  return [row];
}

function fieldName(emoji: string, label: string, count: number): string {
  return `${emoji ? `${emoji} ` : ""}${label} (${count})`;
}

function formatRsvpLine(userId: string, rsvp?: RsvpRow): string {
  const parts: string[] = [`<@${userId}>`];
  if (rsvp?.arrival) parts.push(`arrives ${rsvp.arrival}`);
  if (rsvp?.departure) parts.push(`leaves ${rsvp.departure}`);
  if (rsvp?.note) parts.push(`"${rsvp.note}"`);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} (${parts.slice(1).join(", ")})`;
}

export function buildEventEmbed(event: EventRow): EmbedBuilder {
  const rsvps = db
    .query<RsvpRow, [number]>("SELECT * FROM rsvps WHERE eventId = ?")
    .all(event.id);

  const byStatus = {
    yes: rsvps.filter((r) => r.status === "yes"),
    maybe: rsvps.filter((r) => r.status === "maybe"),
    no: rsvps.filter((r) => r.status === "no"),
  };

  const embed = new EmbedBuilder()
    .setTitle(event.name)
    .setColor(event.cancelled ? 0x808080 : 0x5865f2)
    .addFields(
      { name: "When", value: discordTimestamp(event.startTime, "F"), inline: false },
      {
        name: fieldName(config.events.rsvpEmoji.yes, "Going", byStatus.yes.length),
        value: byStatus.yes.length
          ? byStatus.yes.map((r) => formatRsvpLine(r.userId, r)).join("\n")
          : "—",
        inline: true,
      },
      {
        name: fieldName(config.events.rsvpEmoji.maybe, "Maybe", byStatus.maybe.length),
        value: byStatus.maybe.length
          ? byStatus.maybe.map((r) => formatRsvpLine(r.userId, r)).join("\n")
          : "—",
        inline: true,
      },
      {
        name: fieldName(config.events.rsvpEmoji.no, "Can't go", byStatus.no.length),
        value: byStatus.no.length
          ? byStatus.no.map((r) => formatRsvpLine(r.userId, r)).join("\n")
          : "—",
        inline: true,
      },
    )
    .setFooter({ text: `Event #${event.id}${event.cancelled ? " • CANCELLED" : ""}` });

  if (event.description) embed.setDescription(event.description);

  return embed;
}
