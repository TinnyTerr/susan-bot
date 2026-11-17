import { MEDIA_EXTENSIONS } from "../commands/cat";
import { config } from "../config";
import {
  buildReviewMessage,
  cleanUploadName,
  countPendingFor,
  createUpload,
  setReviewMessage,
  uploadToFiles,
} from "../catUploads";
import { logger } from "../logger";
import { REST, Routes } from "discord.js";
import type { CatUploadRow } from "../db";

export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filename.slice(dot).toLowerCase();
  if (ext === ".jpeg") return ".jpg";
  return MEDIA_EXTENSIONS.has(ext) ? ext : null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

// Cheap content check so a renamed .exe doesn't get stored. Only looks
// at the magic bytes for the formats we accept.
export function looksLikeMedia(ext: string, head: Uint8Array): boolean {
  const at = (offset: number, sig: number[]) => sig.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, s: string) => at(offset, [...s].map((c) => c.charCodeAt(0)));
  switch (ext) {
    case ".jpg":
      return at(0, [0xff, 0xd8, 0xff]);
    case ".png":
      return at(0, [0x89, 0x50, 0x4e, 0x47]);
    case ".gif":
      return ascii(0, "GIF8");
    case ".webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case ".mp4":
    case ".mov":
      return ascii(4, "ftyp") || ascii(4, "moov") || ascii(4, "mdat") || ascii(4, "wide");
    case ".webm":
      return at(0, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}

// Name shown on /cat posts: what the uploader typed, else the filename minus extension.
export function uploadName(typed: string, filename: string): string {
  const fromFile = filename.replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ");
  return cleanUploadName(typed) || cleanUploadName(fromFile) || "untitled";
}

export interface Uploader {
  id: string;
  displayName: string;
  trusted: boolean;
}

export type SaveResult =
  | { ok: true; upload: CatUploadRow }
  | { ok: false; name: string; reason: string };

const rest = new REST().setToken(config.discordToken);

async function postForReview(row: CatUploadRow): Promise<void> {
  const channelId = config.web.reviewChannelId;
  if (!channelId) return;
  try {
    const { embeds, components, allowedMentions } = buildReviewMessage(row);
    const msg = (await rest.post(Routes.channelMessages(channelId), {
      body: {
        embeds: embeds.map((e) => e.toJSON()),
        components: components.map((c) => c.toJSON()),
        allowed_mentions: allowedMentions,
      },
    })) as { id: string };
    setReviewMessage(row.id, channelId, msg.id);
  } catch (err) {
    logger.warn({ err, uploadId: row.id }, "Couldn't post cat upload for review");
  }
}

export async function saveUpload(cat: string, file: File, typedName: string, uploader: Uploader): Promise<SaveResult> {
  const ext = extensionOf(file.name);
  if (!ext) return { ok: false, name: file.name, reason: "unsupported file type" };
  if (file.size === 0) return { ok: false, name: file.name, reason: "empty file" };
  if (file.size > config.cats.maxUploadBytes) {
    const mb = Math.floor(config.cats.maxUploadBytes / 1024 / 1024);
    return { ok: false, name: file.name, reason: `over ${mb} MB` };
  }
  if (!uploader.trusted && countPendingFor(uploader.id) >= config.web.maxPendingPerUser) {
    return { ok: false, name: file.name, reason: "too many uploads waiting for review" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeMedia(ext, bytes.subarray(0, 16))) {
    return { ok: false, name: file.name, reason: "contents don't match the extension" };
  }

  const name = uploadName(typedName, file.name);
  const contentType = CONTENT_TYPES[ext]!;
  let stored: { id: number; rawUrl: string };
  try {
    // Stored under a generated name; the display name lives in our DB/links.txt.
    stored = await uploadToFiles(bytes, `cat-${cat}-${Date.now()}-${uploader.id}${ext}`, contentType);
  } catch (err) {
    logger.error({ err }, "Upload to files server failed");
    return { ok: false, name: file.name, reason: "storage upload failed" };
  }

  const row = createUpload({
    cat,
    name,
    uploaderId: uploader.id,
    uploaderName: uploader.displayName,
    fileId: stored.id,
    url: stored.rawUrl,
    contentType,
    status: uploader.trusted ? "approved" : "pending",
  });
  await postForReview(row);
  return { ok: true, upload: row };
}
