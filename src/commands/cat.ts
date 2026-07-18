import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config";
import { logger } from "../logger";

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
  .setDescription("Post or add photos/videos of our cats")
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Post a random photo or video of one of our cats")
      .addStringOption((o) =>
        o
          .setName("name")
          .setDescription(`Which cat (default: ${config.cats.defaultName || "any"}; use "any" for a random cat)`)
          .setRequired(false)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a photo/video link to a cat's pool")
      .addStringOption((o) =>
        o.setName("url").setDescription("Direct link to an image or video").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("name")
          .setDescription("Cat name (existing or new)")
          .setRequired(true)
          .setAutocomplete(true),
      ),
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

export function listMedia(catName: string): string[] {
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

// Links are stored one-per-line in <mediaDir>/<cat>/links.txt — posted
// directly as message content (Discord auto-embeds them) rather than
// downloaded, so there's no local storage or size limit to worry about.
export function listLinks(catName: string): string[] {
  const file = join(config.cats.mediaDir, catName, "links.txt");
  try {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

type CatMedia = { kind: "file"; path: string } | { kind: "link"; url: string };

function listAllMedia(catName: string): CatMedia[] {
  return [
    ...listMedia(catName).map((path): CatMedia => ({ kind: "file", path })),
    ...listLinks(catName).map((url): CatMedia => ({ kind: "link", url })),
  ];
}

const PRIVATE_HOSTNAME_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.0\.0\.0)/i;

function isValidMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (PRIVATE_HOSTNAME_RE.test(url.hostname)) return false;
  return hasMediaExtension(url.pathname);
}

// Best-effort reachability check — some CDNs reject HEAD (405), which we
// still treat as fine since it confirms the host is up.
async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      return res.ok || res.status === 405;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

export async function autocomplete(interaction: AutocompleteInteraction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = ["any", ...listCats()]
    .filter((name) => name.startsWith(typed))
    .slice(0, 25);
  await interaction.respond(choices.map((name) => ({ name, value: name })));
}

async function executeShow(interaction: ChatInputCommandInteraction) {
  const requested = interaction.options.getString("name")?.toLowerCase() ?? config.cats.defaultName;
  const cats = listCats();

  if (cats.length === 0) {
    await interaction.reply({
      content: `No cat folders found. Create one under \`${config.cats.mediaDir}\` (e.g. \`${config.cats.mediaDir}/susan/\`) and drop photos or videos in it, or add a link with \`/cat add\`.`,
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

  const media = listAllMedia(catName);
  if (media.length === 0) {
    await interaction.reply({
      content: `No photos or videos of ${catName} yet. Add some to \`${join(config.cats.mediaDir, catName)}\` or with \`/cat add\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const picked = media[Math.floor(Math.random() * media.length)]!;

  if (picked.kind === "link") {
    await interaction.reply({ content: picked.url });
    return;
  }

  // Uploading can take a moment for videos, so acknowledge first.
  await interaction.deferReply();
  try {
    await interaction.editReply({
      files: [new AttachmentBuilder(picked.path, { name: basename(picked.path) })],
    });
  } catch (err) {
    logger.error({ err, file: picked.path }, "Failed to upload cat media");
    await interaction.editReply({
      content: `Couldn't upload that one (\`${basename(picked.path)}\`). Try again for a different pick.`,
    });
  }
}

async function executeAdd(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString("url", true).trim();
  const name = interaction.options.getString("name", true).toLowerCase().trim();

  if (!isValidMediaUrl(url)) {
    await interaction.reply({
      content:
        "That doesn't look like a usable direct link — it needs to be http(s) and end in .jpg, .png, .gif, .webp, .mp4, .mov, or .webm.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!(await isUrlReachable(url))) {
    await interaction.editReply({ content: "Couldn't reach that URL — double check the link." });
    return;
  }

  if (listLinks(name).includes(url)) {
    await interaction.editReply({ content: `That link is already in ${name}'s pool.` });
    return;
  }

  const dir = join(config.cats.mediaDir, name);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "links.txt"), url + "\n");

  await interaction.editReply({ content: `Added a link to ${name}'s pool.` });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "add") {
    await executeAdd(interaction);
    return;
  }
  await executeShow(interaction);
}
