import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config";

const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".webm",
]);

export const data = new SlashCommandBuilder()
  .setName("cat")
  .setDescription("Post a random photo or video of one of our cats")
  .addStringOption((o) =>
    o
      .setName("name")
      .setDescription(`Which cat (default: ${config.cats.defaultName || "any"}; use "any" for a random cat)`)
      .setRequired(false)
      .setAutocomplete(true),
  );

function hasMediaExtension(file: string): boolean {
  const dot = file.lastIndexOf(".");
  return dot !== -1 && MEDIA_EXTENSIONS.has(file.slice(dot).toLowerCase());
}

// Cats are the immediate subdirectories of the media dir; each holds that cat's files.
export function listCats(): string[] {
  try {
    return readdirSync(config.cats.mediaDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toLowerCase())
      .sort();
  } catch {
    return [];
  }
}

function listMedia(catName: string): string[] {
  const dir = join(config.cats.mediaDir, catName);
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter(hasMediaExtension)
      .map((file) => join(dir, file))
      .filter((path) => {
        try {
          const stats = statSync(path);
          return stats.isFile() && stats.size <= config.cats.maxUploadBytes;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export async function autocomplete(interaction: AutocompleteInteraction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = ["any", ...listCats()]
    .filter((name) => name.startsWith(typed))
    .slice(0, 25);
  await interaction.respond(choices.map((name) => ({ name, value: name })));
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const requested = interaction.options.getString("name")?.toLowerCase() ?? config.cats.defaultName;
  const cats = listCats();

  if (cats.length === 0) {
    await interaction.reply({
      content: `No cat folders found. Create one under \`${config.cats.mediaDir}\` (e.g. \`${config.cats.mediaDir}/susan/\`) and drop photos or videos in it.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let catName: string;
  if (!requested || requested === "any") {
    catName = cats[Math.floor(Math.random() * cats.length)]!;
  } else if (cats.includes(requested)) {
    catName = requested;
  } else {
    await interaction.reply({
      content: `I don't know a cat called "${requested}". I know: ${cats.join(", ")}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const files = listMedia(catName);
  if (files.length === 0) {
    await interaction.reply({
      content: `No photos or videos of ${catName} yet. Add some to \`${join(config.cats.mediaDir, catName)}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const file = files[Math.floor(Math.random() * files.length)]!;

  // Uploading can take a moment for videos, so acknowledge first.
  await interaction.deferReply();
  try {
    await interaction.editReply({
      files: [new AttachmentBuilder(file, { name: basename(file) })],
    });
  } catch (err) {
    console.error(`Failed to upload ${file}:`, err);
    await interaction.editReply({
      content: `Couldn't upload that one (\`${basename(file)}\`). Try again for a different pick.`,
    });
  }
}
