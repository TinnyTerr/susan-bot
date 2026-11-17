import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

// <mediaDir>/<cat>/links.txt, one link per line: `url[\tname[\tuploaderId]]`.
// Old files with bare URLs still parse. Links are posted directly as message
// content (Discord auto-embeds them) rather than downloaded.
export interface CatLink {
  url: string;
  name?: string;
  uploaderId?: string;
}

// Lowercase letters, digits, dash and underscore. Keeps names usable as a
// folder and stops anything like "../" escaping CAT_MEDIA_DIR.
const CAT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function normaliseCatName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return CAT_NAME_RE.test(name) ? name : null;
}

export function parseLinkLine(line: string): CatLink | null {
  const [url, name, uploaderId] = line.trim().split("\t");
  if (!url) return null;
  return {
    url,
    ...(name ? { name } : {}),
    ...(uploaderId && /^\d+$/.test(uploaderId) ? { uploaderId } : {}),
  };
}

export function formatLinkLine(link: CatLink): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const parts = [clean(link.url)];
  if (link.name || link.uploaderId) parts.push(clean(link.name ?? ""));
  if (link.uploaderId) parts.push(clean(link.uploaderId));
  return parts.join("\t");
}

export function listLinks(catName: string): CatLink[] {
  const file = join(config.cats.mediaDir, catName, "links.txt");
  try {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map(parseLinkLine)
      .filter((l): l is CatLink => l !== null);
  } catch {
    return [];
  }
}

export function appendLink(catName: string, link: CatLink): void {
  const dir = join(config.cats.mediaDir, catName);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "links.txt"), formatLinkLine(link) + "\n");
}
