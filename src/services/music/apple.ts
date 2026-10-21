import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "../../config";
import { fetchJson } from "../media";
import { searchTrack, type RawTrack, type Resolved } from "./track";

export type AppleKind = "song" | "album" | "playlist";

export interface AppleRef {
  kind: AppleKind;
  id: string;
  storefront: string;
}

// music.apple.com/us/album/name/123?i=456 is song 456 inside album 123.
export function parseApple(input: string): AppleRef | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname !== "music.apple.com" && url.hostname !== "embed.music.apple.com") return null;
  const m = url.pathname.match(/^\/([a-z]{2})\/(album|song|playlist)\/(?:[^/]+\/)?([^/]+)\/?$/i);
  if (!m) return null;
  const storefront = m[1]!.toLowerCase();
  const song = url.searchParams.get("i");
  if (m[2] === "album" && song) return { kind: "song", id: song, storefront };
  return { kind: m[2]!.toLowerCase() as AppleKind, id: m[3]!, storefront };
}

export function appleCredsConfigured(): boolean {
  const m = config.music;
  return Boolean(m.appleTeamId && m.appleKeyId && m.applePrivateKeyPath);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

let devToken: { token: string; expires: number } | null = null;

// MusicKit developer token: an ES256 JWT signed with the .p8 key.
function developerToken(): string {
  if (devToken && devToken.expires > Date.now() + 60_000) return devToken.token;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600;
  const head = b64url(JSON.stringify({ alg: "ES256", kid: config.music.appleKeyId }));
  const body = b64url(JSON.stringify({ iss: config.music.appleTeamId, iat: now, exp }));
  const key = createPrivateKey(readFileSync(config.music.applePrivateKeyPath));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  devToken = { token: `${head}.${body}.${b64url(sig)}`, expires: exp * 1000 };
  return devToken.token;
}

interface ApiSong {
  attributes?: { name: string; artistName: string; durationInMillis?: number };
}

const apiSong = (s: ApiSong): RawTrack[] =>
  s.attributes
    ? [searchTrack(s.attributes.name, s.attributes.artistName, s.attributes.durationInMillis ? Math.round(s.attributes.durationInMillis / 1000) : undefined)]
    : [];

async function viaApi({ kind, id, storefront }: AppleRef): Promise<Resolved> {
  const headers = { Authorization: `Bearer ${developerToken()}` };
  const base = `https://api.music.apple.com/v1/catalog/${storefront}`;
  const get = <T>(url: string) => fetchJson<T>(url, { headers });

  if (kind === "song") {
    const r = await get<{ data: ApiSong[] }>(`${base}/songs/${id}`);
    return { tracks: r.data.flatMap(apiSong) };
  }

  const type = kind === "album" ? "albums" : "playlists";
  const meta = await get<{ data: { attributes?: { name: string } }[] }>(`${base}/${type}/${id}`);
  const tracks: RawTrack[] = [];
  let next: string | undefined = `${base}/${type}/${id}/tracks?limit=100`;
  while (next && tracks.length < config.music.maxPlaylistImport) {
    const page: { data: ApiSong[]; next?: string } = await get(next);
    tracks.push(...page.data.flatMap(apiSong));
    next = page.next ? `https://api.music.apple.com${page.next}` : undefined;
  }
  return { collection: meta.data[0]?.attributes?.name, tracks: tracks.slice(0, config.music.maxPlaylistImport) };
}

interface ItunesResult {
  wrapperType: string;
  kind?: string;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
}

export function itunesToResolved(results: ItunesResult[], cap: number): Resolved {
  const tracks = results
    .filter((r) => r.wrapperType === "track" && r.trackName)
    .slice(0, cap)
    .map((r) => searchTrack(r.trackName!, r.artistName, r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined));
  const collection = results.find((r) => r.wrapperType === "collection")?.collectionName;
  return { collection, tracks };
}

// Public, keyless, but only knows songs and albums.
async function viaItunes({ kind, id, storefront }: AppleRef): Promise<Resolved> {
  const entity = kind === "album" ? "&entity=song" : "";
  const r = await fetchJson<{ results: ItunesResult[] }>(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${storefront}${entity}`,
  );
  const out = itunesToResolved(r.results, config.music.maxPlaylistImport);
  // Single-song lookups come back as wrapperType "track" with no collection row.
  if (kind === "song") out.collection = undefined;
  return out;
}

// Playlists need the catalog API; without creds read the page's JSON-LD.
export function playlistFromHtml(html: string, cap: number): Resolved {
  const raw = html.match(/<script[^>]*name="schema:music-playlist"[^>]*>(.*?)<\/script>/s)?.[1];
  if (!raw) throw new Error("couldn't read Apple playlist (set APPLE_MUSIC_* creds)");
  const ld = JSON.parse(raw) as { name?: string; track?: { name?: string; byArtist?: { name?: string } | { name?: string }[] }[] };
  const tracks = (ld.track ?? [])
    .filter((t) => t.name)
    .slice(0, cap)
    .map((t) => {
      const artist = Array.isArray(t.byArtist) ? t.byArtist[0]?.name : t.byArtist?.name;
      return searchTrack(t.name!, artist);
    });
  return { collection: ld.name, tracks };
}

async function playlistViaPage({ id, storefront }: AppleRef): Promise<Resolved> {
  const res = await fetch(`https://music.apple.com/${storefront}/playlist/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Apple Music responded ${res.status}`);
  return playlistFromHtml(await res.text(), config.music.maxPlaylistImport);
}

export async function resolveApple(ref: AppleRef): Promise<Resolved> {
  if (appleCredsConfigured()) return viaApi(ref);
  return ref.kind === "playlist" ? playlistViaPage(ref) : viaItunes(ref);
}
