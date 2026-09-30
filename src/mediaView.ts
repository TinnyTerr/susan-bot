import { EmbedBuilder } from "discord.js";
import type { MediaResult } from "./services/media";

// Top result as a full embed, the rest as a short "also" list in the footer-ish
// field, so one query is one message.
export function buildMediaEmbed(results: MediaResult[]): EmbedBuilder {
  const [top, ...rest] = results;
  if (!top) throw new Error("buildMediaEmbed needs at least one result");

  const embed = new EmbedBuilder()
    .setTitle(top.title)
    .setURL(top.url)
    .addFields(top.fields.map((f) => ({ ...f, inline: true })));

  const description = [top.subtitle ? `*${top.subtitle}*` : null, top.description].filter(Boolean).join("\n\n");
  if (description) embed.setDescription(description);
  if (top.imageUrl) embed.setThumbnail(top.imageUrl);
  if (rest.length) {
    embed.addFields({
      name: "Also",
      value: rest.map((r) => `[${r.title}](${r.url})${r.subtitle ? ` — ${r.subtitle}` : ""}`).join("\n").slice(0, 1024),
    });
  }
  return embed;
}
