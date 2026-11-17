import { defineCommand } from "../utils/defineCommand";
import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  escapeMarkdown,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config";
import { logger } from "../logger";
import { appendLink, type CatLink, listLinks, normaliseCatName } from "../catLinks";
import { buildReviewMessage, getUploaderStatus, listPending, listUploaders, setUploaderStatus } from "../catUploads";
import { canManageCatUploads } from "../permissions";

export { listLinks } from "../catLinks";

export const MEDIA_EXTENSIONS = new Set([
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
      )
      .addStringOption((o) =>
        o
          .setName("stretch")
          .setDescription("Stretch or squeeze the photo (local photos only)")
          .setRequired(false)
          .addChoices(
            { name: "wide", value: "wide" },
            { name: "tall", value: "tall" },
            { name: "random", value: "random" },
          ),
      )
      .addStringOption((o) =>
        o
          .setName("aspect")
          .setDescription('Force an aspect ratio, e.g. "16:9", "1:1" or "2.5" (local photos only)')
          .setRequired(false)
          .setMaxLength(16),
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
  )
  .addSubcommand((sub) => sub.setName("review").setDescription("Review uploads from the upload site (managers)"))
  .addSubcommand((sub) =>
    sub
      .setName("allow")
      .setDescription("Let a user upload without review (managers)")
      .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("deny")
      .setDescription("Block a user from uploading (managers)")
      .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Put a user back to having uploads reviewed (managers)")
      .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName("uploaders").setDescription("List allowed and denied uploaders (managers)"));

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

// Formats Bun.Image can both decode and re-encode. GIFs are left out since
// only the first frame survives, which kills the animation.
const STRETCHABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_STRETCH_SIDE = 4096;

export type StretchMode = "wide" | "tall" | "random";
// A preset, or a target width/height ratio.
export type Warp = StretchMode | { ratio: number };

const MIN_ASPECT = 0.1;
const MAX_ASPECT = 10;

// Accepts "W:H", "WxH", "W/H" or a plain number. Null if unparseable or silly.
export function parseAspect(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:[:x/]\s*(\d+(?:\.\d+)?))?$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = m[2] === undefined ? 1 : Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = w / h;
  return ratio >= MIN_ASPECT && ratio <= MAX_ASPECT ? ratio : null;
}

function isStretchable(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && STRETCHABLE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function randomFactor(): number {
  // 0.35x–2.5x, biased away from ~1 so it's actually noticeable
  const f = 1.4 + Math.random() * 1.1;
  return Math.random() < 0.5 ? f : 1 / f;
}

export function stretchFactors(mode: StretchMode): [number, number] {
  if (mode === "wide") return [2.2, 1];
  if (mode === "tall") return [1, 2.2];
  return [randomFactor(), randomFactor()];
}

// Target size for a warp. Aspect ratios keep the pixel area roughly the same
// so the photo doesn't balloon or shrink, just changes shape.
export function warpSize(width: number, height: number, warp: Warp): [number, number] {
  if (typeof warp === "object") {
    const area = width * height;
    return [Math.sqrt(area * warp.ratio), Math.sqrt(area / warp.ratio)];
  }
  const [fx, fy] = stretchFactors(warp);
  return [width * fx, height * fy];
}

export async function stretchImage(path: string, warp: Warp): Promise<Uint8Array> {
  const image = new Bun.Image(path);
  const { width, height } = await image.metadata();
  let [w, h] = warpSize(width, height, warp);
  // Keep the longest side within bounds without undoing the distortion.
  const scale = Math.min(1, MAX_STRETCH_SIDE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  return image.resize(w, h, { fit: "fill" }).bytes();
}

type CatMedia = { kind: "file"; path: string } | { kind: "link"; link: CatLink };

function listAllMedia(catName: string): CatMedia[] {
  return [
    ...listMedia(catName).map((path): CatMedia => ({ kind: "file", path })),
    ...listLinks(catName).map((link): CatMedia => ({ kind: "link", link })),
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
  const stretchOpt = interaction.options.getString("stretch") as StretchMode | null;
  const aspectOpt = interaction.options.getString("aspect");
  if (stretchOpt && aspectOpt) {
    await interaction.reply({
      content: "Pick either `stretch` or `aspect`, not both.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let stretch: Warp | null = stretchOpt;
  if (aspectOpt) {
    const ratio = parseAspect(aspectOpt);
    if (ratio === null) {
      await interaction.reply({
        content: `Couldn't read "${aspectOpt}" as an aspect ratio. Use something like \`16:9\`, \`1:1\` or \`2.5\` (between ${MIN_ASPECT} and ${MAX_ASPECT}).`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    stretch = { ratio };
  }
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

  let media = listAllMedia(catName);
  if (stretch) {
    media = media.filter((m) => m.kind === "file" && isStretchable(m.path));
    if (media.length === 0) {
      await interaction.reply({
        content: `No local photos of ${catName} to stretch (needs .jpg, .png or .webp files in their folder).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }
  if (media.length === 0) {
    await interaction.reply({
      content: `No photos or videos of ${catName} yet. Add some to \`${join(config.cats.mediaDir, catName)}\` or with \`/cat add\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const picked = media[Math.floor(Math.random() * media.length)]!;

  if (picked.kind === "link") {
    await interaction.reply({ content: linkContent(picked.link), allowedMentions: { parse: [] } });
    return;
  }

  // Uploading can take a moment for videos, so acknowledge first.
  await interaction.deferReply();
  try {
    const file = stretch
      ? new AttachmentBuilder(Buffer.from(await stretchImage(picked.path, stretch)), {
          name: basename(picked.path),
        })
      : new AttachmentBuilder(picked.path, { name: basename(picked.path) });
    await interaction.editReply({ files: [file] });
  } catch (err) {
    logger.error({ err, file: picked.path }, "Failed to upload cat media");
    await interaction.editReply({
      content: `Couldn't upload that one (\`${basename(picked.path)}\`). Try again for a different pick.`,
    });
  }
}

async function executeAdd(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString("url", true).trim();
  const name = normaliseCatName(interaction.options.getString("name", true));
  if (!name) {
    await interaction.reply({
      content: "Cat names can only use letters, numbers, - and _ (max 32).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  if (listLinks(name).some((l) => l.url === url)) {
    await interaction.editReply({ content: `That link is already in ${name}'s pool.` });
    return;
  }

  appendLink(name, { url, uploaderId: interaction.user.id });

  await interaction.editReply({ content: `Added a link to ${name}'s pool.` });
}

// Link posts get a caption when we know who added it / what they called it.
// Mentions are rendered but never pinged (callers pass allowedMentions: none).
export function linkContent(link: CatLink): string {
  const bits: string[] = [];
  if (link.name) bits.push(escapeMarkdown(link.name));
  if (link.uploaderId) bits.push(`from <@${link.uploaderId}>`);
  return bits.length ? `${bits.join(" ")}\n${link.url}` : link.url;
}

async function executeReview(interaction: ChatInputCommandInteraction) {
  const pending = listPending(5);
  if (!pending.length) {
    await interaction.reply({ content: "No uploads waiting for review.", flags: MessageFlags.Ephemeral });
    return;
  }
  // One message per upload so each keeps its own buttons; the first is the reply.
  for (const [i, upload] of pending.entries()) {
    const msg = { ...buildReviewMessage(upload), flags: MessageFlags.Ephemeral as const };
    if (i === 0) await interaction.reply(msg);
    else await interaction.followUp(msg);
  }
}

async function executeUploaderStatus(interaction: ChatInputCommandInteraction, sub: "allow" | "deny" | "reset") {
  const user = interaction.options.getUser("user", true);
  const status = sub === "allow" ? "allowed" : sub === "deny" ? "denied" : "review";
  setUploaderStatus(user.id, status, interaction.user.id);
  const what =
    status === "allowed"
      ? "can upload without review"
      : status === "denied"
        ? "can't upload any more"
        : "is back to having uploads reviewed";
  await interaction.reply({
    content: `<@${user.id}> ${what}.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function executeUploaders(interaction: ChatInputCommandInteraction) {
  const rows = listUploaders();
  const line = (status: string) =>
    rows.filter((r) => r.status === status).map((r) => `<@${r.userId}>`).join(", ") || "none";
  await interaction.reply({
    content: `Allowed (no review): ${line("allowed")}\nDenied: ${line("denied")}\nEveryone else's uploads wait for review.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

const MANAGER_SUBS = new Set(["review", "allow", "deny", "reset", "uploaders"]);

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (MANAGER_SUBS.has(sub) && !canManageCatUploads(interaction)) {
    await interaction.reply({ content: "You can't manage cat uploads.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === "add") return executeAdd(interaction);
  if (sub === "review") return executeReview(interaction);
  if (sub === "uploaders") return executeUploaders(interaction);
  if (sub === "allow" || sub === "deny" || sub === "reset") return executeUploaderStatus(interaction, sub);
  await executeShow(interaction);
}

export default defineCommand({ data, execute, autocomplete });
