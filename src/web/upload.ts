import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_EXTENSIONS } from "../commands/cat";
import { config } from "../config";

// Lowercase letters, digits, dash and underscore. Keeps names usable as a
// folder and stops anything like "../" escaping CAT_MEDIA_DIR.
const CAT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function normaliseCatName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return CAT_NAME_RE.test(name) ? name : null;
}

export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filename.slice(dot).toLowerCase();
  if (ext === ".jpeg") return ".jpg";
  return MEDIA_EXTENSIONS.has(ext) ? ext : null;
}

// Cheap content check so a renamed .exe doesn't land in the pool. Only looks
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

export type SaveResult = { ok: true; file: string } | { ok: false; name: string; reason: string };

export async function saveUpload(cat: string, file: File, uploader: string): Promise<SaveResult> {
  const ext = extensionOf(file.name);
  if (!ext) return { ok: false, name: file.name, reason: "unsupported file type" };
  if (file.size === 0) return { ok: false, name: file.name, reason: "empty file" };
  if (file.size > config.cats.maxUploadBytes) {
    const mb = Math.floor(config.cats.maxUploadBytes / 1024 / 1024);
    return { ok: false, name: file.name, reason: `over ${mb} MB` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeMedia(ext, bytes.subarray(0, 16))) {
    return { ok: false, name: file.name, reason: "contents don't match the extension" };
  }

  const dir = join(config.cats.mediaDir, cat);
  mkdirSync(dir, { recursive: true });
  // Never trust the client's filename for the path.
  const safeUser = uploader.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "web";
  const stored = `web-${Date.now()}-${safeUser}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  await Bun.write(join(dir, stored), bytes);
  return { ok: true, file: stored };
}
